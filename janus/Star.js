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

const log = require( '../component/Log' )( 'Star' );
const uuid = require( '../component/UuidPrefix' )( 'msg' );
const events = require( '../component/Events' );
const nano = require( 'nanomsg' );
const WS = require( 'ws' );
const util = require( 'util' );

const jConfStr = process.argv[ 2 ];
const pConfStr = process.argv[ 3 ];
const jConf = JSON.parse( jConfStr );
const pConf = JSON.parse( pConfStr );

const processId = uuid.get( 'pid' );
//log( 'PID', processId );

/* main */

const ns = {};
ns.Star = function( jConf, pConf ) {
	const self = this;
	log( 'star', {
		j   : jConf,
		p   : pConf,
		pid : processId,
	});
	
	self.isRecording = pConf.isRecording;
	self.roomId = pConf.roomId || 'bucket';
	
	self.ready = false;
	self.users = {};
	self.userIds = [];
	self.publishers = {};
	self.presenceUser = null;
	self.presenceSession = null;
	
	self.pluginPre = 'janus.plugin.';
	self.defaultPlugin = 'videoroom';
	self.filePath = __dirname + '/rec/' + self.roomId + '/';
	
	self.init( jConf );
}

ns.Star.prototype.init = async function( jConf ) {
	const self = this;
	self.pConn = new ns.PConn();
	self.pConn.on( 'close'        , e => self.close( 'presence' ));
	self.pConn.on( 'signal'       , e => self.handleSignal( e ));
	self.pConn.on( 'add_user'     , e => self.addUser( e ));
	self.pConn.on( 'remove_user'  , e => self.removeUser( e ));
	self.pConn.on( 'set_recording', e => self.setRecording( e ));
	
	self.jConn = new ns.JConn( jConf );
	self.jConn.on( 'close',    e => self.close( 'janus' ));
	self.jConn.on( 'detached', e => self.handlePluginDetach( e ));
	self.jConn.on( 'event',    e => self.handleEvent( e ));
	self.jConn.on( 'webrtcup', e => self.handleWebRTCUp( e ));
	self.jConn.on( 'media',    e => self.handleMedia( e ));
	
	self.signalHandlers = {
		'ready'   : ( uId, e ) => self.handleClientReady(  uId, e ),
		'source'  : ( uId, e ) => self.handleClientSource( uId, e ),
	};
	
	self.sourceHandlers = {
		'permissions'   : ( uId, e ) => self.handleClientPermissions( uId, e ),
		'webrtc-source' : ( uId, e ) => self.handleClientRTC(         uId, e ),
	};
	
	self.peerHandlers = {
		'sync'             : ( ...args ) => self.handlePeerSync(        ...args ),
		'sync-accept'      : ( ...args ) => self.handlePeerSyncAccept(  ...args ),
		'open'             : ( ...args ) => self.handlePeerOpen(        ...args ),
		'webrtc-sink'      : ( ...args ) => self.handlePeerRTC(         ...args ),
		'meta'             : ( ...args ) => self.handlePeerMeta(        ...args ),
		//'tracks-available' : ( ...args ) => self.handleTracksAvailable( ...args ),
	};
	
	self.webRTCHandlers = {
		'sdp'       : ( ...args ) => self.handleRTCSDP(       ...args ),
		'candidate' : ( ...args ) => self.handleRTCCandidate( ...args ),
	};
	
	await self.jConn.initialize();
	
	//await self.getJanusInfo();
	self.addUser( 'presence' );
}

ns.Star.prototype.close = function( from ) {
	const self = this;
	if ( self.pConn )
		self.pConn.close();
	
	if ( self.jConn )
		self.jConn.close();
	
	log( 'close, called from', from );
	process.exit( 0 );
}

ns.Star.prototype.handleSignal = function( msg ) {
	const self = this;
	const userId = msg.user_id;
	const event = msg.event;
	if ( !userId || !self.users[ userId ] ) {
		log( 'handleSignal - no user for', {
			msg    : msg,
			userId : userId,
		}, 3 );
		return;
	}
	
	let handler = self.signalHandlers[ event.type ];
	if ( handler ) {
		handler( userId, event.data );
		return;
	}
	
	if ( self.users[ event.type ]) {
		self.handlePeerEvent( userId, event.type, event.data );
		return;
	}
	
	/*
	log( 'handleSignal', {
		from  : userId,
		event : event,
	}, 3 );
	*/
	const data = event.data;
	handler = self.signalHandlers[ data.type ];
	if ( handler ) {
		handler( userId, event );
		return;
	}
	
	log( 'handleSignal - no handler for', msg, 3 );
}

ns.Star.prototype.handlePeerEvent = async function( userId, peerId, event ) {
	const self = this;
	/*
	log( 'handlePeerEvent', {
		uId   : userId,
		pId   : peerId,
		event : event,
	});
	*/
	const type = event.type;
	const handler = self.peerHandlers[ type ];
	if ( !handler ) {
		log( 'handlePeerEvent - no handler, forwarding to peer', event );
		const forward = {
			type : userId,
			data : event,
		};
		self.pConn.sendTo( peerId, forward );
		return;
	}
	
	let res = await handler( userId, peerId, event.data );
	if ( !res )
		return;
	
	//log( 'handlePeerEvent - res', res );
	res = {
		type : peerId,
		data : {
			type : type,
			data : res,
		},
	};
	self.pConn.sendTo( userId, res );
}

ns.Star.prototype.handlePeerSync = async function( userId, peerId, timestamp ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return null;
	
	let pub = user.peers[ peerId ];
	log( 'handlePeerSync', {
		uId : userId,
		pId : peerId,
		ts  : timestamp,
		pub : pub
	}, 4 );
	
	if ( !pub ) {
		pub = 'client-waiting';
		user.peers[ peerId ] = pub;
		return null;
	}
	
	if ( 'client-waiting' == pub ) {
		self.updatePublishers( userId );
		return null;
	}
	
	const peer = self.getUser( peerId );
	if ( !peer )
		return null;
	
	user.peers[ peerId ] = pub;
	return ( timestamp - 1 );
}

ns.Star.prototype.handlePeerSyncAccept = async function( userId, peerId, event ) {
	const self = this;
	//log( 'handlePeerSyncAccept', event );
	/*
	const open = {
		type : peerId,
		data : {
			type : 'open',
			data : event,
		},
	};
	self.pConn.sendTo( userId, open );
	*/
	
	return null;
}

ns.Star.prototype.handlePeerOpen = async function( userId, peerId, open ) {
	const self = this;
	//log( 'handlePeerOpen', open );
	const user = self.getUser( userId );
	const pub = user.peers[ peerId ];
	pub.state = 'open';
	const meta = {
		browser : 'janus',
		sending : {
			audio : true,
			video : true,
		},
	};
	
	const event = {
		type : peerId,
		data : {
			type : 'meta',
			data : meta,
		},
	};
	
	self.pConn.sendTo( userId, event );
}

ns.Star.prototype.handlePeerMeta = async function( userId, peerId, meta ) {
	const self = this;
	const user = self.getUser( userId );
	const conn = user.conns[ peerId ];
	const peer = self.getUser( peerId );
	/*
	log( 'handlePeerMeta', {
		meta : meta,
		user : user,
		conn : conn,
	}, 3 );
	*/
	if ( !user.room.userId )
		throw new Error( 'not room.userId yet, aka not publsihed' );
	
	if ( conn ) {
		log( 'handlePeerMeta - already subscribed to this peer', {
			peerId : peerId,
			user   : user,
			peer   : peer,
		}, 4 );
		return;
	}
	
	const pub = user.peers[ peerId ];
	log( 'handlePeerMeta', {
		userId : userId,
		peerId : peerId,
		pub    : pub,
	});
	
	self.subscribe( userId, pub );
}

ns.Star.prototype.updatePublishers = async function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	const res = await self.getParticipantsList( userId );
	if ( !res ) {
		log( 'updatePublishers - no res=?', res, 3 );
		return;
	}
	
	const parts = res.participants;
	log( 'updatePublishers', {
		userId : userId,
		parts  : parts,
	}, 4 );
	
	parts.forEach( p => {
		const peer = self.getUser( p.id );
		log( 'p', {
			p : p,
			peer : !!peer,
		});
		if ( !p.publisher )
			return;
		
		if ( !peer )
			return;
		
		const peerId = peer.userId;
		if ( peerId === userId )
			return;
		
		user.peers[ peerId ] = p.id;
	});
}

ns.Star.prototype.handlePeerRTC = async function( userId, peerId, event ) {
	const self = this;
	const type = event.type;
	const handler = self.webRTCHandlers[ type ];
	/*
	log( 'handlePeerRTC', {
		uId   : userId,
		pId   : peerId,
		event : event,
	}, 3 );
	*/
	let res = null;
	try {
		res = await handler( userId, peerId, event.data );
	} catch( ex ) {
		log( 'handlePeerRTC - handler ex', {
			ex    : ex,
			event : event,	
			userId : userId,
			peerId, peerId,
		}, 3 );
		return null;
	}
	
	return res;
}

ns.Star.prototype.handleTracksAvailable = function( uId, pId, tracks ) {
	const self = this;
	//log( 'handleTracksAvailable', tracks );
}

ns.Star.prototype.handleClientReady = function( userId, event ) {
	const self = this;
	/*
	log( 'handleClientReady', {
		userId : userId,
		event  : event,
	}, 3 );
	*/
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	user.ready = true;
	if ( !user.room )
		return;
	
	self.sendRoomConf( userId );
}

ns.Star.prototype.handleClientSource = async function( userId, event ) {
	const self = this;
	//log( 'handleClientSource', event );
	const type = event.type;
	const handler = self.sourceHandlers[ type ];
	if ( !handler ) {
		log( 'handleClientSouirce - no handler for', event );
		return;
	}
	
	let res = await handler( userId, event.data );
	if ( !res )
		return null;
	
	res = {
		type : 'source',
		data : {
			type : type,
			data : res,
		},
	};
	//log( 'handleClientSource - res', res );
	self.pConn.sendTo( userId, res );
}

ns.Star.prototype.handleClientPermissions = function( userId, event ) {
	const self = this;
	const user = self.getUser( userId );
	log( 'handleclientPermissions', {
		userId : userId,
		event  : event,
	}, 3 );
	user.permissions = event;
}

ns.Star.prototype.handleClientRTC = async function( userId, event ) {
	const self = this;
	//log( 'handleClientRTC', event );
	const type = event.type;
	const handler = self.webRTCHandlers[ type ];
	if ( !handler ) {
		log( 'handleClientRTC - no handler for', event );
		return;
	}
	
	let res = null;
	res = await handler( userId, 'source', event.data );
	if ( !res )
		return null;
	
	res = {
		type : type,
		data : res,
	};
	
	return res;
}

ns.Star.prototype.handleRTCSDP = async function( userId, peerId, event ) {
	const self = this;
	log( 'handleRTCSDP', {
		userId : userId,
		peerId : peerId,
		event  : event,
	});
	const user = self.getUser( userId );
	let conf = null;
	if ( 'offer' == event.type )
		conf = getPublisherConf( user );
	else
		conf = getSubscriberConf();
	
	/*
	let action = 'configure';
	let rec = true;
	let file = self.filePath + '/' + Date.now() + '-' + userId;
	if ( 'answer' === event.type ) {
		red = false;
		file = null;
		action = 'start';
	}
	
	const pub = {
		request  : action,
		audio    : true,
		video    : true,
		record   : rec,
		filename : file,
	};
	*/
	const jsep = event;
	let res = null;
	try {
		res = await self.requestJRM( userId, peerId, conf, jsep );
	} catch( ex ) {
		log( 'handleRTCSDP - req ex', ex );
		return null;
	}
	
	//log( 'handleRTCSDP - res', res, 3 );
	const sdp = res.jsep;
	const data = res.plugindata.data;
	log( 'handleRTCSDP - data', data, 3 );
	return sdp;
	
	function getPublisherConf( user ) {
		const send = user.permissions.send;
		const recPath = self.filePath + Date.now() + '-' + user.userId;
		const pub = {
			request  : 'configure',
			audio    : send.audio,
			video    : send.video,
			record   : self.isRecording,
			filename : recPath,
		};
		
		log( 'getPublisherConf', pub );
		return pub;
	}
	
	function getSubscriberConf() {
		const recv = user.permissions.receive;
		const sub = {
			request : 'start',
			audio   : recv.audio,
			video   : recv.video,
		};
		log( 'getSubscriberConf', sub );
		return sub;
	}
}

ns.Star.prototype.handleRTCCandidate = async function( userId, peerId, event ) {
	const self = this;
	//log( 'handleRTCCandidate', event );
	const trickle = {
		janus     : 'trickle',
		candidate : event,
	};
	let res = null;
	try {
		res = await self.sendJH( userId, peerId, trickle );
	} catch( ex ) {
		log( 'handleRTCCandidate - req ex', res );
	}
}

ns.Star.prototype.addUser = function( userId ) {
	const self = this;
	if ( !self.ready && 'presence' !== userId ) {
		self.userIds.push( userId );
		return;
	}
	
	/*
	log( 'addUser', {
		pid    : processId,
		roomId : self.roomId,
		userId : userId,
	});
	*/
	
	if ( self.users[ userId ]) {
		log( 'addUser - user already exists, reconnect maybe?', {
			uid   : userId,
			users : self.users,
		}, 4 );
		return;
	}
	
	const user = {
		userId  : userId,
		state   : 'new',
		session : null,
		conns   : {},
		peers   : {},
	};
	
	try {
		self.setUser( user );
		self.createSession( userId );
	} catch( ex ) {
		log( 'addUser - ex', ex );
	}
}

ns.Star.prototype.removeUser = async function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	const users = Object.keys( self.users );
	if ( !user ) {
		log( 'removeUser - not found', {
			roomId : self.roomId,
			uid    : userId,
			users  : users,
			uids   : self.userIds,
		}, 4 );
		return;
	}
	
	/*
	log( 'removeUser', {
		pid   : processId,
		room  : self.roomId,
		user  : user,
		users : users,
	}, 3 );
	*/
	
	//
	self.stopKeepAlive( userId )
	
	//
	await self.unPublish( userId );
	
	//
	await self.detachConns( userId );
	
	//
	delete self.users[ userId ];
	if ( user.session )
		delete self.users[ user.session.str ];
	if ( user.room )
		delete self.users[ user.room.userId ];
	
	self.userIds = self.userIds.filter( uId => uId != userId );
	
	// close session
	const destroy = {
		janus      : 'destroy',
		session_id : user.session.id,
	}
	try {
		await self.jConn.request( destroy );
	} catch( ex ) {
		log( 'err while destroying session', {
			ex   : ex,
			user : user,
		});
	}
	
	user.state = 'closed';
	//log( 'user removed', user, 3 );
	
	if ( self.userIds.length )
		return;
	
	//log( 'removeUser - no users left', self.users );
	self.close( 'self' );
}

ns.Star.prototype.setRecording = function( isRecording ) {
	const self = this;
	log( 'setRecording', isRecording );
	if ( self.isRecording === isRecording )
		return;
	
	self.isRecording = isRecording;
}

ns.Star.prototype.getJanusInfo = async function() {
	const self = this;
	const info = {
		'janus' : 'info',
	};
	let res = null;
	try {
		res = await self.jConn.request( info );
	} catch( ex ) {
		log( 'getJanusInfo failed', ex );
		return;
	}
	
	log( 'getJanusInfo', res, 3 );
}

ns.Star.prototype.createSession = async function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	//log( 'createSession', userId );
	if ( !user ) {
		log( 'createSession - no user for', userId );
		return;
	}
	
	const create = {
		janus      : 'create',
		videocodec : 'h264,vp9,vp8',
		record     : true,
		rec_dir    : '/home/sokken/dev/janus_rec',
	};
	
	let res = null;
	try {
		res = await self.jConn.request( create );
	} catch( ex ) {
		log( 'createSession - ex', ex );
		return;
	}
	
	log( 'session created for', userId );
	const sessionId = res.data.id;
	user.session = {
		id  : sessionId,
		str : sessionId + '',
	}
	user.state = 'session';
	self.setUser( user, user.session.str );
	self.startKeepAlive( userId );
	
	await self.attachVideoRoom( userId, 'source' );
	if ( 'presence' === userId )
		self.createRoom();
	else
		self.publish( userId );
}

ns.Star.prototype.startKeepAlive = function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	if ( null != user.keepAlive )
		return;
	
	user.keepAlive = setInterval( ping, 1000 * 25 );
	function ping() {
		const keep = {
			janus      : 'keepalive',
			session_id : user.session.id,
		};
		self.jConn.send( keep );
	}
}

ns.Star.prototype.stopKeepAlive = function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	if ( null == user.keepAlive )
		return;
	
	clearInterval( user.keepAlive );
	user.keepAlive = null;
}

ns.Star.prototype.attachVideoRoom = async function( userId, type ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	let conn = user.conns[ type ];
	/*
	log( 'attachVideoRoom', {
		userId : userId,
		type   : type,
		conn   : conn,
	});
	*/
	
	if ( conn ) {
		log( 'already attached, abort' );
		return;
	}
	
	const pName = 'janus.plugin.videoroom';
	conn = {
		type   : type,
		state  : 'new',
		plugin : pName,
	};
	user.conns[ type ] = conn;
	
	const attach = {
		janus      : 'attach',
		session_id : user.session.id,
		plugin     : pName,
	};
	let res = null;
	try {
		res = await self.jConn.request( attach );
	} catch( ex ) {
		log( 'attachVideoRoom - req failed', ex );
		return;
	}
	
	//log( 'attachVideoRoom - res', res );
	const pluginId = res.data.id;
	conn.id     = pluginId;
	conn.str    = pluginId + '';
	conn.state  = 'ready';
	
	user.conns[ conn.str ] = conn;
	//
}

ns.Star.prototype.listRooms = async function( userId ) {
	const self = this;
	//log( 'listRooms', userId );
	const user = self.getUser( userId );
	const list = {
		janus      : 'message',
		session_id : user.session.id,
		handle_id  : user.conns[ 'source' ].id,
		body       : {
			request : 'list',
		},
	};
	let lRes = null;
	try {
		lRes = await self.jConn.request( list );
	} catch( ex ) {
		log( 'listRooms - list ex', ex );
	}
	
	//log( 'listRooms - list', lRes, 3 );
	
}

ns.Star.prototype.createRoom = async function() {
	const self = this;
	const user = self.getUser();
	//log( 'createRoom', user );
	const create = {
		request     : 'create',
		permanent   : false,
		description : 'pretty presence room name',
		publishers  : 42,
	};
	let res = null;
	try {
		res = await self.requestJRM( null, 'source', create );
	} catch( ex ) {
		log( 'createRoom - failed to send req', ex );
	}
	
	if ( 'success' != res.janus ) {
		log( 'createRoom - janus could not create?????', res );
		return;
	}
	
	const pData = res.plugindata;
	const conf = pData.data;
	self.janusRoom = {
		id        : conf.room,
		permanent : conf.permanent,
	};
	
	self.janusRoom.type = pData.plugin;
	
	//log( 'createRoom - res', self.janusRoom );
	self.ready = true;
	//
	//log( 'init - add?', self.userIds );
	if ( !self.userIds.length )
		return;
	
	const ids = self.userIds;
	self.userIds = [];
	ids.forEach( uId => self.addUser( uId ));
}

ns.Star.prototype.publish = async function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	/*
	log( 'publish', {
		user : user,
		room : self.janusRoom,
	}, 3 );
	*/
	if ( !user || !self.janusRoom )
		return;
	
	const pub = {
		request : 'join',
		ptype   : 'publisher',
		room    : self.janusRoom.id,
	};
	
	let res = null;
	try {
		res = await self.requestJRM( userId, 'source', pub );
	} catch( ex ) {
		log( 'publish - failed to request', ex );
	}
	
	const conf = res.plugindata.data;
	user.room = {
		id        : conf.room,
		userId    : conf.id,
		userStr   : conf.id + '',
		privateId : conf.private_id,
	};
	user.state = 'publisher';
	self.setUser( user, user.room.userStr );
	
	log( 'publish - res', {
		joined     : conf,
		userroom   : user.room,
		pubs       : self.publishers,
	}, 3 );
	
	await self.updatePublishers( userId );
	
	if ( !user.ready )
		return;
	
	self.sendRoomConf();
}

ns.Star.prototype.subscribe = async function( userId, pubId ) {
	const self = this;
	const user = self.getUser( userId );
	const peer = self.getUser( pubId );
	/*
	log( 'subscribe', {
		publsiherId : pubId,
		user        : user.userId,
		peer        : peer.userId,
	}, 4 );
	*/
	if ( !peer ) {
		log( 'subscribe - no peer. users:', self.users, 3 );
		return;
	}
	
	if ( !user || !peer )
		return null;
	
	const peerId = peer.userId;
	let conn = user.conns[ peerId ];
	if ( !conn )
		await self.attachVideoRoom( userId, peerId );
	else {
		if ( 'ready' !== conn.state ) {
			log( 'subscribe - conn not ready, aborting', conn );
			return;
		}
	}
	
	conn = user.conns[ peerId ];
	if ( !conn ) {
		log( 'no conn', {
			peerId : peerId,
			user   : user,
		}, 4 );
		throw new Error( 'asd' );
	}
	
	conn.state = 'subscribing';
	const sub = {
		request    : 'join',
		ptype      : 'subscriber',
		room       : user.room.id,
		feed       : pubId,
		offer_data : false,
		data       : false,
	};
	
	let res = null;
	try {
		res = await self.requestJRM( userId, peerId, sub );
	} catch( ex ) {
		log( 'subscribe req failed', ex );
		conn.state = 'failed';
	}
	
	//log( 'subscribe res', res, 4 );
	const jsep = res.jsep;
	if ( !jsep ) {
		log( 'could not subscribe', res.plugindata.data );
		conn.state = 'failed';
		return null;
	}
	
	conn.publisher = pubId;
	conn.state = 'subscribed';
	user.conns[ pubId ] = conn;
	
	//log( 'subscribe jsep', jsep );
	log( 'subscribed to', {
		uid : user.userId,
		pid : peer.userId,
	});
	// send sdp to client
	const sdp = {
		type : peerId,
		data : {
			type : 'webrtc-sink',
			data : {
				type : 'sdp',
				data : jsep,
			},
		},
	};
	self.pConn.sendTo( userId, sdp );
}

ns.Star.prototype.getParticipantsList = async function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user || !user.room )
		return null;
	
	const list = {
		request : 'listparticipants',
		room    : user.room.id,
	};
	let res = null;
	try {
		res = await self.requestJRM( userId, 'source', list );
	} catch( ex ) {
		log( 'getParticipantsList - req failed', ex );
	}
	
	const plugin = res.plugindata;
	//log( 'getParticipantsList - res', plugin, 3 );
	return plugin.data;
}

ns.Star.prototype.sendRoomConf = async function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	const parts = await self.getParticipantsList( userId );
	const room = {
		type : 'room',
		data : {
			participants : parts,
		},
	};
	self.pConn.sendTo( user.userId, room );
}

ns.Star.prototype.unPublish = async function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	const unp = {
		request : 'unpublish',
	};
	let res = null;
	try {
		res = await self.requestJRM( userId, 'source', unp );
	} catch( ex ) {
		log( 'unPublish - req ex', ex );
		return;
	}
	
	log( 'unPublish res', {
		user : user,
		res  : res,
	}, 4 );
	
}

ns.Star.prototype.leave = async function( userId, unPubId ) {
	const self = this;
	const req = {
		request : 'leave',
	};
	let res = null;
	try {
		res = await self.requestJRM( userId, unPubId, req );
	} catch( ex ) {
		log( 'leave - req ex', ex );
		return;
	}
	
	//log( 'leave - res', res );
	return res;
}

ns.Star.prototype.detachConns = async function( userId ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	const cIds = Object.keys( user.conns );
	const conns = {};
	cIds.forEach( cId => {
		const conn = user.conns[ cId ];
		conns[ conn.type ] = conn;
	});
	const pIds = Object.keys( conns );
	await Promise.all( pIds.map( pId => {
		self.detachConn( userId, pId );
	}));
}

ns.Star.prototype.detachConn = async function( userId, type ) {
	const self = this;
	const user = self.getUser( userId );
	/*
	log( 'detachConn', {
		user : userId,
		type : type,
	});
	*/
	
	if ( !user )
		return;
	
	const conn = user.conns[ type ];
	if ( !conn ) {
		log( 'detachConn - no plugin found for', {
			user   : user,
			type   : type,
		});
		return;
	}
	
	delete user.conns[ type ];
	//log( 'detach from', conn );
	const detach = {
		janus      : 'detach',
		session_id : user.session.id,
		handle_id  : conn.id,
	};
	let res = null;
	try {
		res = await self.jConn.request( detach );
	} catch( ex ) {
		log( 'detachConn - req ex', ex );
		return;
	}
	
	// fake result
	// actual detach event is received sometime later
}

ns.Star.prototype.handlePluginDetach = function( event ) {
	const self = this;
	const user = self.getUser( event.session_id );
	if ( !user )
		return;
	
	const cId = event.sender + '';
	const conn = user.conns[ cId ];
	/*
	log( 'handlePluginDetach', {
		conns : user.conns,
		cId   : cId,
		conn  : conn,
	}, 3 );
	*/
	if ( !conn )
		return;
		//throw new Error( 'plugin detach' );
	
	delete user.conns[ cId ];
	delete user.conns[ conn.type ];
	log( 'detached', {
		user : user,
		conn : conn,
	}, 4 );
}

ns.Star.prototype.handleEvent = function( event ) {
	const self = this;
	const user = self.getUser( event.session_id );
	if ( !user ) {
		log( 'handleEvent - no user for', {
			event  : event,
			plugin : event.plugindata.data,
			users  : self.users,
		});
		return;
	}
	
	const uId = user.userId;
	const plugin = event.plugindata.data;
	const jsep = event.jsep;
	if ( jsep ) {
		const connId = event.sender + '';
		const conn = user.conns[ connId ];
		if ( !conn )
			return;
		
		const peerId = conn.type;
		self.handleSubRTCChange( uId, peerId, jsep );
		return;
	}
	
	if ( plugin.publishers ) {
		self.handlePublishers( uId, plugin.publishers );
		return;
	}
	
	if ( plugin.unpublished ) {
		self.handleUnPublish( uId, plugin.unpublished );
		return;
	}
	
	if ( plugin.leaving ) {
		self.handleLeaving( uId, plugin.leaving );
		return;
	}
	
	log( 'handleEvent - unhandled', {
		event  : event,
		h0     : '************',
		plugin : plugin,
		h1     : '************',
		jsep   : jsep,
		h2     : '************',
		user   : user,
	}, 4 );
	
}

ns.Star.prototype.handleWebRTCUp = function( event ) {
	const self = this;
	const user = self.getUser( event.session_id );
	/*
	log( 'handleWebRTCUp', {
		event : event,
		user  : user,
	}, 3 );
	*/
}

ns.Star.prototype.handleMedia = function( event ) {
	const self = this;
	const user = self.getUser( event.session_id );
	/*
	log( 'handleMedia', {
		event : event,
		user  : user,
	}, 3 );
	*/
}

ns.Star.prototype.handleSubRTCChange = function( userId, peerId, jsep ) {
	const self = this;
	log( 'handleSubRTCChange', {
		userId : userId,
		peerId : peerId,
		jsep   : jsep,
	});
	const sdp = {
		type : peerId,
		data : {
			type : 'webrtc-sink',
			data : {
				type : 'sdp',
				data : jsep,
			},
		},
	};
	
	self.pConn.sendTo( userId, sdp );
}

ns.Star.prototype.handlePublishers = function( userId, publishers ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user ) {
		log( 'handlePublishers - no user for', {
			userId : userId,
			users  : self.users,
		});
		return;
	}
	
	publishers.forEach( pub => {
		const peer = self.getUser( pub.id );
		if ( !peer ) {
			log( 'handlePublishers - no peer for', {
				user       : user,
				publishers : publishers,
				peers      : user.peers,
			}, 3 );
			return null;
		}
		
		const peerId = peer.userId;
		log( 'handlePublisher', {
			userId : userId,
			peerId : peerId,
			pub    : pub,
		});
		user.peers[ peerId ] = pub.id;
	});
	/*
	publishers.forEach( p => {
		self.subscribe( userId, p.id );
	});
	*/
}

ns.Star.prototype.handleUnPublish = async function( userId, unPubId ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	const unPubStr = unPubId + '';
	const pub = user.conns[ unPubStr ];
	log( 'handleUnPublish', {
		userId  : userId,
		user    : user,
		unpubid : unPubId,
		pub     : pub,
	}, 4 );
	
	if ( !pub )
		return;
	
	delete user.conns[ unPubStr ];
	delete user.peers[ pub.type ];
	await self.leave( userId, unPubId );
	await self.detachConn( userId, pub.type );
}

ns.Star.prototype.handleLeaving = async function( userId, leaveId ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	const leaveStr = leaveId + '';
	/*
	log( 'handleLeaving', {
		user     : user,
		leaveStr : leaveStr,
	}, 4 );
	*/
}

ns.Star.prototype.getUser = function( uId ) {
	const self = this;
	/*
	log( 'getUser', {
		uId   : uId,
		pUser : self.presenceUser,
	});
	*/
	if ( 'presence' ===  uId || null == uId )
		return self.presenceUser;
	
	uId = uId + '';
	if ( uId === self.presenceSession )
		return self.presenceUser;
	
	if ( uId === self.presencePlugin )
		return self.presenceUser;
	
	return self.users[ uId ] || null;
}

ns.Star.prototype.setUser = function( user, id ) {
	const self = this;
	/*
	log( 'setUser', {
		user : user,
		id   : id,
	});
	*/
	const uId = user.userId;
	if ( 'presence' === uId ) {
		self.presenceUser = user;
		if ( user.session )
			self.presenceSession = user.session.str;
		
		const plugin = user.conns[ 'source' ];
		if ( plugin )
			self.presencePlugin = plugin.str;
		
		return;
	}
	
	if ( null == self.users[ uId ]) {
		self.users[ uId ] = user;
		self.userIds.push( uId );
	}
	
	if ( !id )
		return;
	
	id = id + '';
	if ( uId === id )
		return;
	
	if ( self.users[ id ])
		return;
	
	self.users[ id ] = user;
}

ns.Star.prototype.getPluginName = function( type ) {
	const self = this;
	type = type || self.defaultPlugin;
	name = self.pluginPre + type;
	return name;
}

ns.Star.prototype.sendJH = function( userId, type, event ) {
	const self = this;
	const user = self.getUser( userId );
	if ( !user )
		return;
	
	let conn = null;
	if ( type )
		conn = user.conns[ type ];
	
	event.session_id = user.session.id;
	if ( conn )
		event.handle_id = conn.id;
	
	//log( 'sendJH', event );
	return self.jConn.send( event );
}

ns.Star.prototype.requestJRM = function( userId, connId, body, jsep ) {
	const self = this;
	const user = self.getUser( userId );
	let conn = null;
	if ( connId )
		conn = user.conns[ connId ];
	
	/*
	log( 'requestJRM', {
		uId : userId,
		cId : connId,
		user : user,
		body : body,
	}, 3 );
	*/
	const req = {
		janus : 'message',
		session_id : user.session.id,
		body       : body,
	};
	
	if ( conn )
		req.handle_id = conn.id;
	
	if ( jsep )
		req.jsep = jsep;
	
	return self.jConn.request( req );
}

/*
	PConn - presence connection
*/

const pLog = require( '../component/Log' )( 'Star/PConn' );
ns.PConn = function() {
	const self = this;
	events.Emitter.call( self, pSink );
	
	self.init();
	
	function pSink( ...args ) {
		pLog( 'pSink', args );
	}
}

util.inherits( ns.PConn, events.Emitter );

// Public

ns.PConn.prototype.sendTo = function( userId, event ) {
	const self = this;
	const signal = {
		type : 'signal',
		data : {
			event   : event,
			user_id : userId,
		},
	};
	//pLog( 'sendTo', signal, 3 );
	try {
		const str = JSON.stringify( signal );
		process.send( str );
	} catch( ex ) {
		pLog( 'sendTo - failed to send event', signal, 3 );
	}
}

ns.PConn.prototype.close = function() {
	const self = this;
	//pLog( 'close' );
	self.emitterClose();
}

// Private

ns.PConn.prototype.init = function() {
	const self = this;
	process.on( 'message', e => self.handleMsg( e ));
}

ns.PConn.prototype.handleMsg = function( msg ) {
	const self = this;
	let event = null;
	try {
		event = JSON.parse( msg );
	} catch( ex ) {
		log( 'on_message  - could not parse', msg );
		return;
	}
	
	self.emit( event.type, event.data );
}

/*
	JConn - janus connection
*/

const jLog = require( '../component/Log' )( 'Star/JConn' );
ns.JConn = function( conf ) {
	const self = this;
	events.Emitter.call( self, jSink );
	self.domain = conf.domain;
	self.port = conf.port;
	
	self.requests = {};
	
	function jSink( ...args ) {
		jLog( 'jSink', args );
	}
}

util.inherits( ns.JConn, events.Emitter );

ns.JConn.prototype.initialize = async function() {
	const self = this;
	jLog( 'initialize', {
		domain : self.domain,
		port   : self.port,
	});
	
	await self.connectWS( self.domain, self.port );
	return true;
}

// Public

ns.JConn.prototype.request = function( event ) {
	const self = this;
	return new Promise(( resolve, reject ) => {
		const reqId = uuid.get( 'jr' );
		event.transaction = reqId;
		self.requests[ reqId ] = {
			event    : event,
			reqId    : reqId,
			callback : reqBack,
		};
		
		//jLog( 'request', event );
		const str = JSON.stringify( event );
		try {
			self.conn.send( str );
		} catch( ex ) {
			jLog( 'failed to send request', event );
			delete self.requests[ reqId ];
			reject( ex );
		}
		
		function reqBack( err, res ) {
			if ( err )
				reject( err );
			else
				resolve( res );
		}
	});
}

ns.JConn.prototype.send = function( event ) {
	const self = this;
	const eventId = uuid.get( 'je' );
	event.transaction = eventId;
	const str = JSON.stringify( event );
	try {
		self.conn.send( str );
	} catch( ex ) {
		jLog( 'failed to send event', event );
	}
}

ns.JConn.prototype.close = function() {
	const self = this;
	self.emitterClose();
	if ( !self.conn )
		return;
	
	try {
		self.conn.close();
	} catch( ex ) {
		jLog( 'close - ex', ex );
	}
	
	delete self.conn;
}

// Private

ns.JConn.prototype.connectNano = async function( host, port ) {
	const self = this;
	const dns = require( 'dns' );
	const lookup = util.promisify( dns.lookup );
	let res = null;
	try {
		res = await lookup( host );
	} catch( ex ) {
		jLog( 'initialize - failed to look up domain', ex );
		throw ex;
	}
	
	jLog( 'dns res', res );
	const ip = res.address;
	const addr = 'tcp://' + ip + ':' + port;
	jLog( 'nano - addr', addr );
	self.conn = nano.socket( 'pair' );
	self.conn.setEncoding( 'utf8' );
	self.conn.on( 'data', e => self.handleMsg( e ));
	self.conn.on( 'error', e => jLog( 'tcp err', e ));
	self.conn.on( 'close', e => jLog( 'tcp close', e ));
	self.conn.connect( addr );
}

ns.JConn.prototype.connectWS = function( host, port ) {
	const self = this;
	return new Promise(( resolve, reject ) => {
		const addr = 'ws://' + host + ':' + port;
		jLog( 'ws - addr', addr );
		try {
			self.conn = new WS( addr, 'janus-protocol' );
		} catch ( ex ) {
			jLog( 'connectWS - ex', ex );
			reject( ex );
			return false;
		}
		
		self.conn.on( 'message', e => self.handleMsg( e ));
		self.conn.on( 'error', e => jLog( 'ws err', e ));
		self.conn.on( 'close', e => jLog( 'ws close', e ));
		self.conn.on( 'open', e => {
			jLog( 'ws open', e );
			resolve();
		});
	});
}

ns.JConn.prototype.handleMsg = function( msg ) {
	const self = this;
	const event = JSON.parse( msg );
	//jLog( 'handleMsg', event );
	if ( !event.transaction ) 
		self.handleEvent( event );
	else
		self.handleReply( event );
}

ns.JConn.prototype.handleEvent = function( event ) {
	const self = this;
	jLog( 'handleEvent', event );
	self.emit( event.janus, event );
}

ns.JConn.prototype.handleReply = function( reply ) {
	const self = this;
	if ( 'ack' === reply.janus ) {
		//jLog( 'handleReply, got ack, dropping', reply );
		return;
	}
	
	const id = reply.transaction;
	const req = self.requests[ id ];
	if ( !req ) {
		jLog( 'no handler for reply', reply, 4 );
		return;
	}
	
	/*
	jLog( 'req/reply', {
		req   : req.event,
		reply : reply,
	});
	*/
	if ( 'error' === reply.janus ) {
		req.callback( reply, null );
		return;
	}
	
	req.callback( null, reply );
}

// hootytooties
new ns.Star( jConf, pConf );
