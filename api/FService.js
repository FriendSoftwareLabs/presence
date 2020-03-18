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

'user strict';

const log = require( '../component/Log' )( 'FService' );
const uuid = require( '../component/UuidPrefix' )( 'blah' );
const events = require( '../component/Events' );

const WS = require( 'ws' );
const util = require( 'util' );

const ns = {};

/* FService

This is the API for services to communicate with FriendCore

fcConf : <obj> - from config.js, server.friendcore section.
expected content:
{
	host         : <string>,
	wsPort       : <num/string> OR <null>,
	wsProxy      : <string> OR <null>,
	useTLS       : <bool>
	serviceToken : <string>
}

This class is an event emitter following the schema
{
	type : '<string>',
	data : <obj>,
}

where type will be event type to listen for and
data will be passed to the listener

The event emitter interface is defined in the Emitter class

*/

ns.FService = function( fcConf, destinationApp ) {
	let self = null;
	if ( !global.FService ) {
		self = this;
		global.FService = self;
	} else
		self = global.FService;
	
	
	if ( null == self.ready ) {
		const debug = false;
		events.Emitter.call( self, FSink, debug );
		self.ready = false;
		self.conn = null;
		self.requests = {};
		self.sendQueue = [];
	}
	
	if ( !fcConf  ) {
		return global.FService;
	}
	
	self.init( fcConf, destinationApp );
	return self;
	
	function FSink( ...args ) {
		//log( 'FSink', args, 4 );
	}
}

util.inherits( ns.FService, events.Emitter );

// Public

/* sendNotification

username : <string> - Friend username to send notification to
title    : <string> - Notification title
message  : <string> - Notification message

*/

ns.FService.prototype.sendNotification = async function(
		users,
		title,
		message,
		channel,
		timestamp,
		extra,
		destApp
	) {
	const self = this;
	extra = checkExtra( extra );
	destApp = self.checkString( destApp ) || self.destApp;
	channel = self.checkString( channel );
	title = self.checkString( title );
	message = self.checkString( message );
	if (
		!users
		|| ( 'string' === typeof( users ))
		|| !users.length
		|| !title
		|| !message
	) {
		throw new Error( 'ERR_INVALID_ARGUMENTS' );
	}
	
	const notie = {
		type : 'notification',
		data : {
			users             : users,
			channel_id        : channel,
			notification_type : 1,
			title             : title,
			message           : message,
			timecreated       : timestamp,
			extra             : extra,
			application       : destApp,
		},
	};
	
	log( 'sendNotification', notie, 4 );
	
	let err = await self.send( notie );
	if ( err )
		throw err;
	
	return true;
	
	function checkExtra( extra ) {
		if ( !extra )
			return null;
		
		if ( 'string' === typeof( extra ))
			return extra;
		
		try {
			extra = JSON.stringify( extra );
		} catch( e ) {
			log( 'could not string', extra, 3 );
			extra = null;
		}
		
		return extra;
	}
}

ns.FService.prototype.getWorkgroupList = async function() {
	const self = this;
	const reqId = uuid.get( 'req' );
	const req = {
		type : 'group',
		data : {
			type : 'list',
			data : {
				requestid : reqId,
			},
		},
	};
	let res = null;
	try {
		res = await self.sendRequest( req, reqId );
	} catch( err ) {
		throw err;
	}
	
	return res;
}

/* Get a list of all Friend users and when they were last updated

Returns a promise that resolves to a list of user objects:
{
	userid     : <uuid string>
	lastupdate : <unix timestamp>
}
*/
ns.FService.prototype.getUserList = async function() {
	const self = this;
	const reqId = uuid.get( 'req' );
	const req = {
		type : 'user',
		data : {
			type : 'list',
			data : {
				requestid : reqId,
			},
		},
	};
	let res = null;
	try {
		res = await self.sendRequest( req, reqId );
	} catch( err ) {
		throw err;
	}
	
	return res;
}

/* Fetch a user info from Friend

fUserId : <uuid string>

returns a promise that resolves to a Friend user object
*/
ns.FService.prototype.getUser = async function( fUserId ) {
	const self = this;
	if ( !fUserId || !fUserId.length || !( 'string' === typeof( fUserId )) ) {
		log( 'getUser - invalid fUserId', fUserId );
		throw new Error( 'ERR_INVALID_ARGUMENTS' );
	}
	
	const reqId = uuid.get( 'req' );
	const req = {
		type : 'user',
		data : {
			type : 'get',
			data : {
				requestid : reqId,
				userid    : fUserId,
			},
		},
	};
	let res = null;
	try {
		res = await self.sendRequest( req, reqId );
	} catch( err ) {
		throw err;
	}
	
	return res;
}

ns.FService.prototype.close = function() {
	const self = this;
	self.release();
	self.cleanupConn();
	delete self.fcc;
}

// Private

ns.FService.prototype.init = function( fcConf, destApp ) {
	const self = this;
	if ( !fcConf )
		return;
	
	if ( destApp )
		self.destApp = destApp;
	
	log( 'init //:;;:\\\\' );
	self.fcc = fcConf;
	self.connect();
}

ns.FService.prototype.connect = function() {
	const self = this;
	if ( self.conn )
		self.cleanupConn();
	
	if ( !self.fcc.serviceKey ) {
		log( 'FService.connect - no service key, aborting', self.fcc );
		return;
	}
	
	self.conn = new ns.FCWS(
		self.fcc.host,
		self.fcc.wsPort,
		self.fcc.serviceKey,
		self.fcc.serviceName,
		self.fcc.wsProxy,
		self.fcc.useTLS,
	);
	
	self.conn.on( 'open'   , e => self.handleConnOpen( e ));
	self.conn.on( 'error'  , e => self.handleConnError( e ));
	self.conn.on( 'closed' , e => self.handleConnClosed( e ));
	self.conn.on( 'reply'  , e => self.handleReply( e ));
	self.conn.on( 'service', e => self.handleService( e ));
}

ns.FService.prototype.handleService = function( event ) {
	const self = this;
	self.emit( event.type, event.data );
}

ns.FService.prototype.handleConnOpen = function( fcInfo ) {
	const self = this;
	self.ready = true;
	if ( self.sendQueue && self.sendQueue.length ) {
		self.sendQueue.forEach( e => self.send( e ));
		self.sendQueue = [];
	}
	
	self.emit( 'ready', fcInfo );
}

ns.FService.prototype.handleConnError = function( errCode ) {
	const self = this;
	self.ready = false;
	log( 'handleConnError', errCode );
	self.emit( 'error', errCode );
}

ns.FService.prototype.handleConnClosed = function( reason ) {
	const self = this;
	self.ready = false;
	log( 'handleConnClosed', reason );
	self.emit( 'closed', reason );
}

ns.FService.prototype.cleanupConn = function() {
	const self = this;
	if ( !self.conn )
		return;
	
	self.conn.close();
	delete self.conn;
}

ns.FService.prototype.send = async function( event ) {
	const self = this;
	if ( !self.conn || !self.ready ) {
		log( 'send - not conn or ready, queueing', {
			conn  : !!self.conn,
			ready : self.ready,
		});
		self.sendQueue.push( event );
		return null;
	}
	
	const wrap = {
		type : 'service',
		data : event,
	};
	
	return await self.conn.send( wrap );
}

ns.FService.prototype.sendRequest = function( req, reqId ) {
	const self = this;
	return new Promise(( resolve, reject ) => {
		self.setCallback(
			req,
			reqId,
			resolve,
			reject
		);
		
		self.send( req )
			.then( ok )
			.catch( ex );
		
		function ex( err ) {
			self.cancelRequest( reqId, err );
		}
		
		function ok() {
		}
	});
}

ns.FService.prototype.setCallback = function(
	req,
	reqId,
	resolve,
	reject
) {
	const self = this;
	self.requests[ reqId ] = {
		id      : reqId,
		event   : req,
		resolve : resolve,
		reject  : reject,
		timeout : setTimeout( timeoutHit, 1000 * 15 ),
	};
	
	function timeoutHit() {
		const req = self.requests[ reqId ];
		log( 'request timeout hit', req, 3 );
		if ( !req )
			return;
		
		req.timeout = true;
		req.reject( 'ERR_REQUEST_TIMEOUT' );
	}
}

ns.FService.prototype.handleReply = function( event ) {
	const self = this;
	const reqId = event.requestId;
	const res = event.result;
	const err = event.error;
	const req = self.requests[ reqId ];
	if ( !req ) {
		log( 'handleReply - no request for reply', {
			reply    : event,
			requests : self.requests,
		});
		return;
	}
	
	if ( true === req.timeout ) {
		log( 'handleReply - reply received after timeout hit', {
			req   : req,
			reply : reply,
		});
		delete self.requests[ reqId ];
		return;
	}
	
	if ( null != req.timeout )
		clearTimeout( req.timeout );
	
	delete self.requests[ reqId ];
	
	if ( err )
		req.reject( err );
	else
		req.resolve( res );
	
}

ns.FService.prototype.cancelRequest = function( reqId, err ) {
	const self = this;
	const req = self.requests[ reqId ];
	if ( !req )
		return;
	
	const to = req.timeout;
	if ( true !== to )
		clearTimeout( to );
	
	delete self.requests[ reqId ];
	request.reject( err );
}

ns.FService.prototype.checkString = function( str ) {
	if ( 'string' !== typeof( str ))
		return null;
	
	return str.toString();
}

ns.FService.prototype.checkArray = function( list ) {
	
}

module.exports = ns.FService;

/* FCWS - websocket connection to FriendCore

host : <string> - domain FC can be reached on
port : <num/string> OR <null> optional - port to connect on.
	   If proxy is defined, port will be ignored
serviceToken : <string> - identifies the service to FC
proxy : <string> OR <null> optional - connect thorugh a proxy.
		Port will be ignored
useTLS : <bool> default <true> optional - connects over
		 TLS/SSL. Will not fall back to unsecure.


This class is an event emitter following the schema
{
	type : '<string>',
	data : <obj>,
}

where type will be event type to listen for and
data will be passed to the listener

The event emitter interface is defined in the events.Emitter class

*/

const wsLog = require( '../component/Log' )( 'FCWS' );
ns.FCWS = function(
	host,
	port,
	serviceKey,
	serviceName,
	proxy,
	useTLS
) {
	const self = this;
	events.Emitter.call( self, FCWSEventSink );
	self.host = host;
	self.port = port;
	self.proxy = proxy;
	self.serviceKey = serviceKey;
	self.serviceName = serviceName;
	self.useTLS = useTLS;
	
	self.reconnectTimeout = 1000 * 10;
	self.pinger = null;
	self.pingMap = {};
	self.pingRate = 1000 * 10;
	self.pingTimeout = 1000 * 5;
	
	self.state = 'new';
	self.init();
	
	function FCWSEventSink( ...args ) {
		wsLog( 'FCWSEventSink', args, 4 );
	}
}

util.inherits( ns.FCWS, events.Emitter );

// Public

/* send an event to FC

event - <obj>, event to be sent to FC

returns a error object

*/
ns.FCWS.prototype.send = function( event ) {
	const self = this;
	return self.sendOnWS( event );
}

ns.FCWS.prototype.reconnect = function() {
	const self = this;
	if ( 'closed' === self.state || null == self.state )
		return;
	
	self.cleanupWS();
	self.connect();
}

// Immediatly destroy everything, unsent messages are not sent
ns.FCWS.prototype.close = function() {
	const self = this;
	self.stopPing();
	self.release();
	self.cleanupWS();
	
	delete self.host;
	delete self.port;
	delete self.proxy;
	delete self.serviceKey;
	delete self.serviceName;
	delete self.useTLS;
}

// Private

ns.FCWS.prototype.init = function() {
	const self = this;
	self.on( 'authenticate', onAuth );
	self.on( 'notify', onNotify );
	self.on( 'ping', onPing );
	self.on( 'pong', onPong );
	self.connect();
	
	function onAuth( e ) { self.handleAuth( e ); }
	function onNotify( e ) { self.handleNotify( e ); }
	function onPing( e ) { self.handlePing( e ); }
	function onPong( e ) { self.handlePong( e ); }
}

ns.FCWS.prototype.handleAuth = function( res ) {
	const self = this;
	wsLog( 'handleAuth', res );
	if ( 0 !== res.status ) {
		wsLog( 'FCWS.handleAuth - error', res );
		self.state = 'error';
		self.emitState( 'ERR_AUTHENTICATE' );
		return;
	}
	
	self.state = 'open';
	self.emitState( res );
	self.startPing();
}

ns.FCWS.prototype.handleNotify = function( event ) {
	const self = this;
	wsLog( 'handleNotify - you are doing it wrong', event );
}

ns.FCWS.prototype.startPing = function() {
	const self = this;
	self.pinger = setInterval( send, self.pingRate );
	
	/*
	const pEvent = {
		path      : '/service/room/create',
		requestId : 'asdasdasdasd',
		data      : {
			originUserId : '09d93096949105a095e91a31b0733674',
			name         : 'boopies',
		},
	};
	self.handleFCEvent( JSON.stringify( pEvent ));
	*/
	
	function send() {
		if ( null == self.pinger )
			return;
		
		self.sendPing();
	}
}

ns.FCWS.prototype.sendPing = function() {
	const self = this;
	const time = String( Date.now());
	const ping = {
		type : 'ping',
		data : time,
	};
	self.send( ping );
	self.pingMap[ time ] = setTimeout( timeout, self.pingTimeout );
	
	function timeout() {
		self.stopPing();
		self.state = 'error';
		self.tryReconnect();
	}
}

ns.FCWS.prototype.handlePing = function( timestamp ) {
	const self = this;
	const pong = {
		type : 'pong',
		data : timestamp,
	};
	self.send( pong );
}

ns.FCWS.prototype.handlePong = function( timestamp ) {
	const self = this;
	const timer = self.pingMap[ timestamp ];
	if ( null == timer ) {
		wsLog( 'handlePong - no timer for', {
			ts  : timestamp,
			map : self.pingMap,
		}, 3 );
		return;
	}
	
	clearTimeout( timer );
	delete self.pingMap[ timestamp ];
}

ns.FCWS.prototype.stopPing = function() {
	const self = this;
	const pings = Object.keys( self.pingMap );
	pings.forEach( ping => {
		const timer = self.pingMap[ ping ];
		delete self.pingMap[ ping ];
		if ( timer == null )
			return;
		
		clearTimeout( timer );
	});
	
	if ( null == self.pinger )
		return;
	
	clearInterval( self.pinger );
	delete self.pinger;
}

ns.FCWS.prototype.connect = function() {
	const self = this;
	if ( self.ws )
		self.cleanupWS();
	
	self.state = 'connecting';
	const subProto = [ 'FriendService-v1' ];
	const opts = {
		rejectUnauthorized : false,
	};
	
	const host = self.buildHost();
	self.ws = new WS( host, subProto, opts );
	self.ws.on( 'open', open );
	self.ws.on( 'close', close );
	self.ws.on( 'error', error );
	self.ws.on( 'message', msg );
	
	function open( e ) { self.handleOpen(); }
	function close( e ) { self.handleClose( e ); }
	function error( e ) { self.handleError( e ); }
	function msg( e ) { self.handleFCEvent( e ); }
}

ns.FCWS.prototype.releaseWS = function() {
	const self = this;
	if ( !self.ws )
		return;
	
	self.ws.removeAllListeners();
}

ns.FCWS.prototype.handleOpen = async function() {
	const self = this;
	self.state = 'authenticating';
	const auth = {
		type : 'authenticate',
		data : {
			serviceKey  : self.serviceKey,
			serviceName : self.serviceName,
		},
	};
	
	const err = await self.send( auth );
	if ( err ) {
		wsLog( 'sending authenticate failed', err );
		self.state = 'error';
		self.tryReconnect();
	}
}

ns.FCWS.prototype.handleClose = function( code ) {
	const self = this;
	self.stopPing();
	if ( 'closed' === self.state )
		return;
	
	self.state = 'error';
	self.tryReconnect();
}

ns.FCWS.prototype.handleError = function( e ) {
	const self = this;
	wsLog( 'FCWS.handleError', e );
	/*
	self.state = 'error';
	self.tryReconnect();
	*/
}

ns.FCWS.prototype.tryReconnect = function() {
	const self = this;
	if ( 'connect-wait' === self.state || 'connecting' === self.state ) {
		wsLog( 'tryReconnect - connecting things already happening, noop' );
		return;
	}
	
	if ( 'error' !== self.state ) {
		wsLog( 'tryReconnect - state not error, noop', self.state );
		return;
	}
	
	if ( !self.serviceKey ) {
		wsLog( 'tryReconnect - no serviceKey, cannot reconnect, closing FCWS' );
		self.cleanupWS();
		return;
	}
	
	self.state = 'connect-wait';
	self.reconnectWaiting = setTimeout( reconnect, self.reconnectTimeout );
	function reconnect() {
		self.reconnectWaiting = null;
		self.reconnect();
	}
}

ns.FCWS.prototype.handleFCEvent = function( msgStr ) {
	const self = this;
	let event = null;
	try {
		event = JSON.parse( msgStr );
	} catch( e ) {
		wsLog( 'handleFCEvent - could not parse event', msgStr );
		return;
	}
	
	if ( !event )
		return;
	
	/*
	if (( 'ping' != event.type ) && ( 'pong' != event.type ))
		wsLog( 'FCEvent', msgStr );
	*/
	
	self.emit( event.type, event.data );
}

ns.FCWS.prototype.sendOnWS = async function( event ) {
	const self = this;
	if ( !self.ws )
		return ns.FSError( 'ERR_NO_WS' );
	
	let str = null;
	try {
		str = JSON.stringify( event );
	} catch ( e ) {
		wsLog( 'send() - failed to stringify', event );
	}
	
	if ( !str || !str.length )
		return ns.FSError( 'ERR_COULD_NOT_STRINGIFY', event );
	
	/*
	if (( 'ping' != event.type ) && ( 'pong' != event.type ))
		wsLog( 'sendOnWs', str );
	*/
	
	let err = await send( str );
	if ( err )
		return err;
	else
		return null;
	
	function send( str ) {
		return new Promise(( resolve, reject ) => {
			try {
				self.ws.send( str, ack );
			} catch( ex ) {
				let err = ns.FSError( 'ERR_WS_SEND', ex.message || ex );
				resolve( err );
				return;
			}
			
			function ack( err ) {
				if ( err ) {
					//wsLog( 'send - failed to send', err );
					let e = ns.FSError( 'ERR_WS_SEND', err.message || err );
					resolve( e );
				} else
					resolve( null );
			}
		});
	}
}

ns.FCWS.prototype.cleanupWS = function() {
	const self = this;
	//wsLog( 'cleanupWS', !!self.ws );
	if ( self.reconnectWaiting ) {
		clearTimeout( self.reconnectWaiting );
		self.reconnectWaiting = null;
	}
	
	if ( self.ws )
		self.releaseWS();
	
	const ws = self.ws;
	delete self.ws;
	try {
		ws.close();
	} catch( e ) {}
	
	self.state = 'closed';
	self.emitState();
}

ns.FCWS.prototype.emitState = function( event ) {
	const self = this;
	self.emit( self.state, event || null );
}

ns.FCWS.prototype.buildHost = function() {
	const self = this;
	let host = !!self.useTLS ? 'wss://' : 'ws://';
	host = setDomain( host );
	if ( self.proxy )
		host = setProxy( host );
	else
		host = setPort( host );
	
	return host;
	
	function setDomain( host ) {
		let protoCheck = self.host.split( '://' );
		if ( 1 !== protoCheck.length )
			self.host = protoCheck[ 1 ];
		
		self.host = self.host.split( '/' )[ 0 ];
		return host + self.host;
	}
	
	function setProxy( host ) {
		if ( '/' !== self.proxy[ 0 ])
			self.proxy = '/' + self.proxy;
		
		return host + self.proxy;
	}
	
	function setPort( host ) {
		self.port = self.port.toString();
		if ( ':' !== self.port[ 0 ])
			self.port = ':' + self.port;
		
		return host + self.port;
	}
}

/*
	Friend Service Error
*/

ns.FSError = function( code, errObj ) {
	let ex = null;
	try {
		throw new Error();
	} catch( e ) {
		ex = e;
	}
	
	const error = {
		type  : 'error',
		error : code,
		data  : errObj,
		stack : ex.stack,
	};
	return error;
}

