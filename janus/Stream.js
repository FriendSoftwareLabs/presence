/*©agpl*************************************************************************
*                                                                              *
* This file is part of FRIEND UNIFYING PLATFORM.                               *
*                                                                              *
* This program is free software: you can redistribute it and/or modify         *
* it under the terms of the GNU Affero General Public License as published by  *
* the Free Software Foundation, either version 3 of the License, or            *
* (at your option) any later version.                                          *
*                                                                              *
* This program is distributed in the hope that it will be useful,              *
* but WITHOUT ANY WARRANTY; without even the implied warranty of               *
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the                 *
* GNU Affero General Public License for more details.                          *
*                                                                              *
* You should have received a copy of the GNU Affero General Public License     *
* along with this program.  If not, see <http://www.gnu.org/licenses/>.        *
*                                                                              *
*****************************************************************************©*/

/* This is the child process of Janus.js. REST calls are sent from here.
 *
 * There is no 1:1 mapping between FriendChat requests and Janus requests.
 * Some FriendChat requests take multiple Janus calls. To avoid race conditions,
 * Janus requests are serialized into a queue. Each participant has its own
 * request queue.
 */

const log = require( '../component/Log' )( 'Janus-child' );
const uuid = require( 'uuid' );
const https = require( 'https' );
const querystring = require( 'querystring' );


const jConfStr = process.argv[ 2 ];
const pConfStr = process.argv[ 3 ];
const jConf = JSON.parse( jConfStr );
const pConf = JSON.parse( pConfStr );

const confStr = process.argv[2];
const conf = JSON.parse( confStr );
log( 'confs', {
	j : jConf,
	p : pConf,
});

const API_URL = jConf.api_url;
const API_KEY = jConf.api_key;

//TODO: new room has to be created somehow - study how Janus videoroom demo does it
//For testing a long-running Janus instance has room 1234 created by the demo code.
var room_id = Math.floor( Math.random() * 100000000 ); //this should be a room-unique integer
var room_ready = false;
var parent_event_queue = [];

var users = {}; // maps user_id to session data
var user_ids = [];
var sessions = {}; // maps user_id to internal id, and back
var listeners = [];
var listeners_waiting = [];

var GLOBAL_source_id = null;
var source_listen_id = null;
var source_is_streaming = false;

// events from parnet presence server
const presence_events = {
	'set_source'    : set_source,
	'add_user'      : add_user,
	'remove_user'   : remove_user,
	'signal'        : handle_signal,
	'restart'       : user_restart,
};

// signal event ^^^
const signal_map = {
	'webrtc-source' : source,
	'webrtc-sink'   : sink,
	'restart'       : signal_restart,
}

// things to do
const request_map = {
	'create'        : create,
	'attach_plugin' : attach_plugin,
	'detach_plugin' : detach_plugin,
	'list'          : list,
	'join'          : join,
	'leave'         : leave,
	'configure'     : configure,
	'start'         : start,
	'trickle'       : trickle,
};

// listen for events from presence
process.on( 'message', on_message );
function on_message (str) {
	let event = null;
	try {
		event = JSON.parse(str);
	} catch( ex ) {
		log( 'on_message  - could not parse', str );
		return;
	}
	
	if ( event.type == 'close' ){
		log('Ending subprocess ********* TODO ********');
		
		//TODO: remove room from keepalive list
		//TODO: clean up Janus session
		
		process.exit( 0 );
		return;
	}
	
	if ( !room_ready ) {
		parent_event_queue.push( event );
		return;
	}
	
	handle_parent_event( event );
}

function handle_parent_event( event ) {
	let handler = presence_events[ event.type ];
	if ( !handler ) {
		log( 'on_message  - no handler for', event );
		return;
	}
	handler( event.data );
}

// add janus api requests to the request queue of a user
function add_event( event, user_id ) {
	let user = users[ user_id ];
	if ( !user ) {
		log( 'add_event - no user for', user_id );
		return;
	}
	
	event.user_id = user_id;
	user.queue.push( event );
	process_queue( user_id );
}

// init

// get a list of available rooms

// create a system user
const system_user = {
	id           : 'system',
	session_id   : null,
	is_publisher : false,
	request      : false,
	queue        : [],
};
users[ 'system' ] = system_user;
add_event({
	action : 'create',
}, system_user.id );
add_event({
	action : 'attach_plugin',
}, system_user.id );
add_event({
	action : 'list',
}, system_user.id );

// attach to plugin
// get a list of rooms
// set this instance to an empty room

log('process started ' + API_URL + ' ' + API_KEY );

// stuff

function process_queue( user_id ){
	let user = users[ user_id ];
	if ( !user ) {
		log( 'process_queue - no user for', user_id );
		return;
	}
	
	if ( !!user.request )
		return;
	
	if ( user.queue.length == 0 )
		return; //nothing to do

	const event = user.queue.shift();
	const handler = request_map[ event.action ];
	if ( !handler ) {
		log( 'no handler for event', event, 5 );
		process_queue( user_id );
		return;
	}
	
	handler( event );
	process_queue( user_id );
}

/*
	request builders
*/

function create( event ) {
	const uid = event.user_id;
	const req = {};
	req.janus = "create";
	req.transaction = uuid();
	http_json_post(
		API_URL,
		req,
		uid,
		create_back
		//create_request_callback
	);
	
	function create_back( err, res ) {
		if ( err ) {
			log( 'create - req err:', err );
			return;
		}
		
		let sid = res.data.id;
		sid = sid.toString();
		sessions[ sid ] = {
			id      : sid,
			user_id : uid,
		};
		let user = users[ uid ];
		user.session_id = sid;
		log ( 'create_back - sessions', sessions );
		
		poll_session( user.id );
	}
}

function attach_plugin( event ) {
	const uid = event.user_id;
	const user = get_user( uid );
	const req = {};
	req.janus = 'attach';
	req.plugin = "janus.plugin.videoroom";
	req.opaqueId = uid;
	
	const url = build_url( user.session_id );
	http_json_post(
		url,
		req,
		uid,
		attach_back
		//attach_plugin_callback
	);
	
	function attach_back( err , res ) {
		if ( err ) {
			log( 'attach_plugin - req err', err );
			return;
		}
		
		let sid = res.session_id;
		let pid = res.data.id;
		let user = users[ uid ];
		if ( !user.publisher_id )
			user.publisher_id = pid;
		else {
			user.listener_id = pid;
		}
	}
}

function detach_plugin( event ) {
	const uid = event.user_id;
	const user = get_user( uid );
	if ( !user )
		return;
	
	const type = event.type;
	const type_id = type + '_id';
	let plugin_id = user[ type_id ];
	req = {
		janus : 'detach',
	};
	const url = build_url(
		user.session_id,
		plugin_id,
	);
	http_json_post(
		url,
		req,
		uid,
		detach_back
	);
	
	function detach_back( err , res ) {
		if ( err ) {
			log( 'detach_back err', err );
			return;
		}
		
		user[ type_id ] = null;
		user[ type ] = null;
	}
}

function list( event ) {
	req = {
		janus : 'message',
		body  : {
			request : 'list',
			plugin  : 'janus.plugin.videoroom'
		},
	};
	
	const user = users[ event.user_id ];
	const url = build_url(
		user.session_id,
		user.publisher_id,
	);
	http_json_post(
		url,
		req,
		user.id,
		list_back
	);
	
	function list_back( err, res ) {
		if ( err ) {
			log( 'list_back - err', err );
			close_room( 'ERR_JANUS_LIST_REQ' );
			return;
		}
		
		let list = null;
		try {
			list = res.plugindata.data.list;
		} catch ( ex ) {
			log( 'list_back - failed to read list', ex );
			close_room( 'ERR_JANUS_NO_LIST' );
			return;
		}
		
		empty_rooms = list.filter( room => 0 === room.num_participants );
		let room = empty_rooms[ 0 ];
		room_id = room.room;
		room_ready = true;
		parent_event_queue.forEach( event => handle_parent_event( event ));
	}
}

function join( event ) {
	const uid = event.user_id;
	const user = users[ uid ];
	if ( !user )
		return;
	
	if ( !event.listener )
		publisher( user );
	else
		listener( user );
	
	function publisher( user ) {
		const req = {};
		req.janus = "message";
		req.body = {
			request    : 'join',
			room       : room_id,
			ptype      : 'publisher',
			display    : uid,
		};
		
		const url = build_url(
			user.session_id,
			user.publisher_id
		);
		
		http_json_post(
			url,
			req,
			user.id,
			publish_back
		);
	}
	
	function listener( user ) {
		if ( !user.publisher ) {
			// tell client to try again?
			return;
		}
		
		const source = users[ GLOBAL_source_id ];
		const req = {};
		user.listening_to = source_listen_id;
		req.janus = 'message';
		req.body = {
			request   : 'join',
			room      : room_id,
			ptype     : 'listener',
			feed      : source_listen_id,
			privat_id : user.publisher.private_id,
		};
		
		const url = build_url(
			user.session_id,
			user.listener_id,
		);
		
		http_json_post(
			url,
			req,
			user.id,
			listen_back
		);
	}
	
	function publish_back( err , res ) {
		if ( err ) {
			log( 'join back - req err', err );
			return;
		}
		
	}
	
	function listen_back( err , res ) {
		user.listener = true;
		flush_client_ICE( user.id );
		flush_client_SDP( user.id );
	}
}

function leave( event ) {
	const uid = event.user_id;
	const user = users[ uid ];
	if ( !user ) {
		log( 'leave - no user for', event );
		return;
	}
	
	const req = {
		janus       : 'message',
		transaction : uuid(),
		body : {
			request : 'leave',
			room    : room_id,
		},
	};
	
	const url = build_url(
		user.session_id,
		user.publisher_id,
	);
	
	http_json_post(
		url,
		req,
		uid,
		leave_back
	);
	
	function leave_back( err, res ) {
		if ( err ) {
			log( 'leave_back - err', err );
			return;
		}
		
		let sid = res.session_id;
		cleanup( sid );
	}
}

function cleanup( session_id ) {
	let session = get_session( session_id );
	if ( !session ) {
		log( 'cleanup - no session for ', session_id );
		return;
	}
	
	let uid = session.user_id;
	let user = users[ uid ];
	let is_source = ( uid === GLOBAL_source_id ) ? true : false;
	delete sessions[ session_id ];
	delete users[ uid ];
	user_ids = Object.keys( users );
	user_ids = user_ids.filter( id => 'system' !== id );
	
	if ( is_source ) {
		GLOBAL_source_id = null;
		source_listen_id = null;
		source_is_streaming = false;
		send_to({
			type : 'source',
			data : null,
		});
		handle_source_state_change();
	} else {
		listeners = user_ids.filter( uid => GLOBAL_source_id !== uid );
	}
	
	if ( !user_ids.length ) {
		stop_system();
		close_room( 'ROOM_EMPTY' );
	}
}

function stop_system() {
	if ( !users[ 'system' ])
		return;
	
	const leave = {
		action : 'leave',
	};
	add_event( leave, 'system' );
}

function configure( event ) {
	const uid = event.user_id;
	const user = get_user( uid );
	if ( !user ) {
		log( 'configure - no user for', event );
		return;
	}
	
	const req = {
		janus : 'message',
		jsep  : event.sdp,
		body  : event.media,
	};
	req.body.request = 'configure';
	
	let pid = user.is_publisher ?
		user.publisher_id : user.listener_id;
	
	const url = build_url(
		user.session_id,
		pid,
	);
	
	http_json_post(
		url,
		req,
		uid,
		config_back,
		//configure_stream_callback
	);
	
	function config_back( err , res ) {
		if ( err ) {
			log( 'configure req err', err );
			return;
		}
	}
}

function start( event ) {
	const uid = event.user_id;
	const user = get_user( uid );
	if ( !user ) {
		log( 'start - no user for', uid );
		return;
	}
	
	const req = {
		janus : 'message',
		jsep  : event.sdp,
		body  : event.media,
	};
	
	req.body.request = 'start';
	const pid = user.listener_id;
	const url = build_url(
		user.session_id,
		pid,
	);
	
	http_json_post(
		url,
		req,
		uid,
		start_back
	);
	
	function start_back( err, res ) {
		if ( err ) {
			log( 'start_back err', err );
			return;
		}
	}
}

function trickle( event ) {
	let uid = event.user_id;
	let user = users[ uid ];
	if ( !user ) {
		process_queue( uid );
		return;
	}
	
	const candidate = event.candidate || event.candidates;
	req = {
		janus       : 'trickle',
		candidate   : candidate,
	};
	
	let pid = user.is_publisher ?
		user.publisher_id : user.listener_id;
	const url = build_url(
		user.session_id,
		pid,
	);
	
	http_json_post(
		url,
		req,
		uid,
		trickle_back
	);
	
	function trickle_back( err , res ) {
		if ( user.ICE_complete )
			flush_client_SDP( user.id );
	}
}

/*
	Presence event handlers
*/

function set_source( source_id ) {
	log( 'set_source', source_id );
	GLOBAL_source_id = source_id;
	if ( !GLOBAL_source_id ) {
		source_is_streaming = false;
		handle_source_state_change();
	}
	
	let source = {
		type : 'source_id',
		data : GLOBAL_source_id,
	};
	send_to( source );
}

function add_user( user_id ) {
	let uid = user_id;
	let is_source = uid === GLOBAL_source_id;
	const user = {
		id           : uid,
		session_id   : null,
		is_publisher : is_source,
		publisher_id : null,
		publisher    : null,
		listener_id  : null,
		listener     : null,
		request : false,
		queue        : [],
		ICE_complete : false,
		sdp          : null,
		candidates   : [],
	};
	users[ uid ] = user;
	user_ids.push( uid );
	
	// create session for this user
	let create = {
		action  : 'create',
	};
	add_event( create, uid );
	
	// create plugin session for this user
	let attach = {
		action  : 'attach_plugin',
	};
	add_event( attach, uid );
	
	// add user to room as publisher or listener, ptype
	
	let join = {
		action  : 'join',
	};
	add_event( join, uid );
}

function remove_user( user_id ) {
	let uid = user_id;
	add_event({
		action  : 'leave',
		user_id : uid,
	}, uid );
}

function handle_signal( data ) {
	const event = data.event;
	const user_id = data.user_id;
	const handler = signal_map[ event.type ];
	if ( !handler ) {
		log( 'handle_signal - no handler for', event );
		return;
	}
	
	handler( event.data, user_id );
}

function user_restart( data, user_id ) {
	log( 'user_restart - NYI', [
		data,
		user_id,
	]);
}

// publisher
function source( event, user_id ) {
	if ( !GLOBAL_source_id ) {
		log( 'source event - source_id has not been set, wtf is this event from?', event );
		return;
	}
	
	if ( user_id !== GLOBAL_source_id ) {
		log( 'source - source id mismatch', [
			user_id,
			GLOBAL_source_id,
		]);
		return;
	}
	
	let uid = user_id;
	let session = users[ uid ];
	if ( !session ) {
		log( 'source - no session, aborting', {
			event     : data,
			source_id : uid,
			users  : users,
		});
		return;
	}
	if ( 'candidate' === event.type ) {
		handle_client_ICE( event.data, uid );
		return;
	}
	
	if ( 'sdp' === event.type ) {
		let media = {
			audio : true,
			video : true,
		};
		handle_source_SDP( event.data, media, uid );
		return;
	}
	
	log( 'unhandled source event', event, 3 );
}

// listener
function sink( event, user_id ) {
	let session = users[ user_id ];
	if( !session ) {
		log( 'sink - no session for, aborting', {
			event    : data,
			user_id  : user_id,
			users : users,
		});
		return;
	}
	
	if ( 'candidate' === event.type ) {
		handle_client_ICE( event.data, user_id );
		return;
	}
	
	if ( 'sdp' === event.type ) {
		let media = {
			audio : true,
			video : true,
		};
		handle_sink_SDP( event.data, media, user_id );
		return;
	}
	
	log( 'unhandled source event', data, 4 );
}

function signal_restart( time_stamp, user_id ) {
	let user = get_user( user_id );
	if ( !user )
		return;
	
	user.queue = [];
	user.sdp = null;
	user.candidates = [];
	user.ICE_complete = false;
	let type = user.is_publisher ? 'publisher' : 'listener';
	if ( user[ type ]) {
		let detach = {
			action  : 'detach_plugin',
			type    : type,
		};
		add_event( detach, user_id );
	}
	
	if ( !user.is_publisher ) {
		setup_listener( user_id );
		return;
	}
	
	let attach = {
		action  : 'attach_plugin',
	};
	add_event( attach, user_id );
	
	let rejoin = {
		action   : 'join',
	};
	add_event( rejoin, user_id );
}

function handle_source_SDP( sdp, media_conf, user_id ) {
	let user = users[ user_id ];
	// we're pretending its always an offer
	sdp = {
		action  : 'configure',
		sdp     : sdp,
		media   : media_conf,
		user_id : user_id,
	};
	if ( !user.publisher || !user.ICE_complete ) {
		user.sdp = sdp;
	} else
		add_event( sdp, user_id );
}

function handle_sink_SDP( sdp, media_conf, user_id ) {
	let user = users[ user_id ];
	// we're pretending its always an answer
	sdp = {
		action  : 'start',
		sdp     : sdp,
		media   : media_conf,
		user_id : user_id,
	};
	
	if ( !user.listener || !user.ICE_complete ) {
		user.sdp = sdp;
		return;
	}
	
	add_event( sdp, user_id );
}

function handle_client_ICE( data, user_id ) {
	let user = users[ user_id ];
	if ( null == data ) {
		user.ICE_complete = true;
		data = { completed : true };
	} else
		user.ICE_complete = false;
	
	let is_ready = false;
	if ( user.is_publisher )
		is_ready = !!user.publisher;
	else
		is_ready = !!user.listener;
	
	if ( !is_ready ) {
		user.candidates = user.candidates || [];
		user.candidates.push( data );
		return;
	}
	
	let trickle = {
		action    : 'trickle',
		user_id   : user_id,
	};
	
	if ( user.candidates ) {
		user.candidates.push( data );
		trickle.candidates = user.candidates;
		user.candidates = [];
	} else
		trickle.candidate = data;
	
	add_event( trickle, user_id );
	
	if ( user.ICE_complete )
		flush_client_SDP( user_id );
}

function flush_client_ICE( user_id ) {
	let user = get_user( user_id );
	if ( !user ) {
		log( 'cant flush ICE, no user' );
		return;
	}
	
	if ( !user.candidates )
		return;
	
	user.candidates.forEach( cand => {
		add_event({
			action     : 'trickle',
			user_id    : user_id,
			candidate : cand,
		}, user_id );
	});
	
	user.candidates = [];
}

function flush_client_SDP( user_id ) {
	const user = get_user( user_id );
	if ( !user ) {
		log( 'flush_client_SDP - no user', user_id );
		return;
	}
	
	if ( !user.ICE_complete )
		return;
	
	if ( !user.sdp )
		return;
	
	add_event( user.sdp, user_id );
	delete user.sdp;
}

function get_user( user_id ) {
	let user = users[ user_id ];
	if ( !user ) {
		log( 'get_user - no user for call from: ', [
			arguments.callee.caller.name,
			user_id,
		]);
		return null;
	}
	
	return user;
}

function get_session( sid ) {
	if ( !sid )
		return null;
	
	let sidStr = sid.toString();
	return sessions[ sidStr ] || null;
}

//

function poll_session( user_id ){
	req = {}
	req.rid = Date.now();
	req.maxev = 1;
	let user = users[ user_id ];
	if ( !user ) {
		log( 'poll_session - no user found, aborting polling', user_id );
		return;
	}
	
	let sid = user.session_id;
	let url = build_url( sid );
	http_get(
		url,
		req,
		user_id,
		poll_back
	);
	
	function poll_back( err , response ) {
		if( response && response.janus !== 'keepalive' )
			handle_poll_event( response, user_id );
		
		poll_session( user_id );
	}
}

function handle_poll_event( event, user_id ) {
	if ( 'webrtcup' === event.janus ) {
		handle_webrtcup( event, user_id );
		return;
	}
	
	if ( 'media' === event.janus ) {
		handle_media_event( event, user_id );
		return;
	}
	
	if ( 'hangup' === event.janus ) {
		handle_hangup( event, user_id );
		return;
	}
	
	if ( event.jsep ) {
		handle_janus_SDP( event.jsep, user_id );
		return;
	}
	
	if ( event.plugindata ) {
		handle_plugin_event( event.plugindata, user_id );
		return;
	}
	
	log( 'unknown poll event for ' + user_id, event, 5 );
}

function handle_webrtcup( data, user_id ) {
	const user = get_user( user_id );
	if ( !user ) {
		log( 'handle_webrtcup - no user for', user_id );
		return;
	}
	
	user.webrtcup = true;
	// tell client
	const stream = {
		type : 'stream-state',
		data : true,
	};
	send_to( stream, user_id );
	
	// tell source
	const clientState = {
		type : 'client-state',
		data : {
			clientId : user_id,
			state    : true,
		},
	};
	send_to( clientState, GLOBAL_source_id );
	
	if ( user_id === GLOBAL_source_id ) {
		source_is_streaming = true;
		handle_source_state_change();
	}
}

function handle_hangup( event, user_id ) {
	const user = get_user( user_id );
	if ( user_id === GLOBAL_source_id ) {
		source_is_streaming = false;
		handle_source_state_change();
	}
	
	if ( !user ) {
		log( 'handle_hangup - no user for', user_id );
		return;
	}
	
	user.webrtcup = false;
	const hangup = {
		type : 'stream-state',
		data : false,
	};
	send_to( hangup, user_id );
	const clientState = {
		type : 'client-state',
		data : {
			clientId : user_id,
			state    : false,
		},
	};
	send_to( clientState, GLOBAL_source_id );
}

function handle_janus_SDP( sdp, user_id ) {
	const event = {
		type : 'sdp',
		data : sdp,
	};
	send_rtc( event, user_id );
}

function handle_media_event( event, user_id ) {
	const media = {
		type : 'media',
		data : {
			type      : event.type,
			receiving : event.receiving,
		},
	};
	send_to( media, user_id );
}

function handle_plugin_event( event, user_id ) {
	let data = event.data;
	if ( 'joined' === data.videoroom ) {
		handle_joined( data, user_id );
		return;
	}
	
	if ( 'event' === data.videoroom ) {
		handle_videoroom_event( data, user_id );
		return;
	}
	
	log( 'unknown plugin event', event );
}

function handle_joined( event, user_id ) {
	let user = users[ user_id ];
	if ( !user )
		return;
	
	if ( !user.publisher ) {
		user.publisher = event;
		//user.publisher_id = event.id;
		if ( user.is_publisher ) {
			source_listen_id = user.publisher.id;
			send_to({
				type : 'joined',
				data : Date.now(),
			}, user_id );
			flush_client_ICE( user_id );
			flush_client_SDP( user_id );
		} else
			setup_listener( user_id );
		
	} else {
		user.listener = event;
		//send_source_state( user_id );
	}
}

function handle_videoroom_event( event, user_id ) {
	log( 'handle_videoroom_event - NYI', event, 4 );
}

// 'internal'

function handle_source_state_change() {
	send_source_state();
	if ( source_is_streaming )
		connect_waiting();
	else
		disconnect_listeners();
	
	function connect_waiting() {
		listeners_waiting.forEach( uid => setup_listener( uid ));
		listeners_waiting = [];
	}
	
	function disconnect_listeners() {
		user_ids.forEach( uid => {
			let user = users[ uid ];
			if ( !user )
				return false;
			
			if ( !user.listener )
				return false;
			
			let detach = {
				action    : 'detach_plugin',
				type      : 'listener',
				user_id   : uid,
			};
			add_event( detach, uid );
			clean_listener_rtc( uid );
			listeners_waiting.push( uid );
		});
	}
}

function setup_listener( user_id ) {
	if ( !source_is_streaming ) {
		log( 'setup_listener - waiting', source_is_streaming );
		listeners_waiting.push( user_id );
		return;
	}
	
	send_source_state( user_id );
	listeners.push( user_id );
	let user = get_user( user_id );
	if ( !user )
		return;
	
	let attach = {
		action : 'attach_plugin',
		user_id : user_id,
	};
	add_event( attach, user_id );
	
	let join = {
		action   : 'join',
		user_id  : user_id,
		listener : true,
	};
	add_event( join, user_id );
}

function clean_listener_rtc( user_id ) {
	const user = get_user( user_id );
	if ( !user )
		return;
	
	user.ICE_complete = false;
	user.candidates = [];
	user.sdp = null;
	user.listening_to = null;
	user.webrtcup = false;
}

function send_source_state( user_id ) {
	const state = {
		type : 'source-state',
		data : source_is_streaming,
	};
	if ( user_id )
		send_to( state, user_id );
	else
		listeners.forEach( lid => send_to( state, lid ));
}

function restart( user_id ) {
	const user = get_user( user_id );
	if ( !user )
		return;
	
	if ( user.is_publisher )
		r_publisher( user );
	else
		r_listener( user );
	
	function r_publisher( user ) {
		log( 'restart publisher', user );
	}
	
	function r_listener( user ) {
		log( 'restart listener', user );
	}
}

function send_rtc( event, user_id ) {
	let dest = 'sink';
	if ( user_id === GLOBAL_source_id )
		dest = 'source';
	
	let type = 'webrtc-' + dest;
	const rtc = {
		type    : type,
		data    : event,
	};
	send_to( rtc, user_id );
}

function send_to( event, user_id ) {
	const stream = {
		type : 'stream',
		data : event,
	};
	
	if ( !user_id )
		broadcast( stream );
	else
		snd( stream, user_id );
	
	function broadcast( stream ) {
		let uids = Object.keys( users );
		uids.forEach( uid => snd( stream, uid ));
	}
	
	function snd( stream, user_id ) {
		const signal = {
			type : 'signal',
			data : {
				event   : stream,
				user_id : user_id,
			},
		};
		send( signal );
	}
}

function close_room( reason ) {
	if ( !room_ready )
		return;
	
	let close = {
		type : 'close',
		data : reason,
	};
	send( close );
	room_ready = false;
}

function send( event ) {
	if ( !room_ready ) {
		log( 'send - room closed, dropping', event );
		return;
	}
	
	try {
		let str = JSON.stringify( event );
		process.send( str );
	} catch ( ex ) {
		log( 'send failed', ex );
		process.exit( 666 );
	}
}

function build_url( sid, pid ) {
	let url = API_URL;
	if ( pid )
		url = url + sid + '/' + pid;
	else
		url = url + sid;
	
	return url;
}

function http_json_post( url, data, user_id, callback ){
	data.apisecret = API_KEY;
	let user = users[ user_id ];
	if ( !user ) {
		log( 'http_json_post - no session for, aborting', user_id );
		return;
	}
	
	if ( user.request ) {
		log( 'http_json_post - already requesting, wtf', user );
		process.exit( 345 );
		return;
	}
	
	let transId = uuid();
	user.request = transId;
	data.transaction = transId;
	let event = data.body ? data.body.request : data.janus;
	var options = {
		uri: url,
		method: 'POST',
		json: data
	};
	
	var request = require( 'request' );
	request( options, function( error, response, body ) {
		if ( !error && response.statusCode == 200 ) {
			handle_janus_response( body, user_id, callback );
			//callback( body /*body is already an object with JSON fields*/ );
			return;
		}
		log("Response error code " + error);
	});
}

function http_get( url, data, user_id, callback ){
	data.apisecret = API_KEY;
	url = url + "?" + serialize_get(data);
	var options = {
		uri: url,
		method: 'GET',
	};
	
	var request = require('request');
	request( options, function( error, response, bodyStr ) {
		if (!error && response.statusCode == 200) {
			let body = null;
			try {
				body = JSON.parse( bodyStr );
			} catch( ex ) {
				log( 'http_get back, parse error for', [
					error,
					response,
					bodyStr,
				]);
				body = null;
			}
			
			handle_janus_response( body, user_id, callback )
			//callback(JSON.parse(body)/*body is a JSON string*/);
			return;
		}
		log("GET error code " + error);
	});
}

function handle_janus_response( res, user_id, callback ) {
	let user = users[ user_id ];
	if ( !user ) {
		log( 'handle_janus_response - no user for', user_id );
		callback( 'ERR_NO_SESSION', null );
		return;
	}
	
	if ( !res ) {
		callback( 'ERR_INVALID_DATA', null );
		return;
	}
	
	// it was a GET/poll returning
	if ( res.transaction === user.request )
		user.request = null;
	
	if ( 'error' === res.janus )
		callback( res.error, null );
	else
		callback( null, res );
	
	process_queue( user_id );
}

function serialize_get(obj){
	var str = [];
	for(var p in obj)
		if (obj.hasOwnProperty(p)) {
		str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
		}
	return str.join("&");
}

//process_queue(); //yes - this has to be last and is called first (at startup)
