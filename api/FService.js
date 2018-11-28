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

ns.FService = function( fcConf ) {
	const self = this;
    if ( global.FService ) {
        return global.FService;
    }
    
    self.conn = null;
    
    self.init( fcConf );
    
    global.FService = self;
    return global.FService;
}

// Public

/* sendNotification

username : <string> - Friend username to send notification to
title : <string> - Notification title
message : <string> - Notification message

*/

ns.FService.prototype.sendNotification = async function( username, title, message ) {
	const self = this;
	username = self.checkString( username );
	title = self.checkString( title );
	message = self.checkString( message );
	if ( !username || !title || !message )
		throw new Error( 'ERR_INVALID_ARGUMENTS' );
	
	const notie = {
		type : 'notification',
		data : {
			username          : username,
			channel_id        : "1",
			notification_type : 1,
			title             : title,
			message           : message,
		},
	};
	//log( 'sendNotification', notie );
	let err = await self.send( notie );
	if ( err )
		throw err;
	
	return true;
}

ns.FService.prototype.close = function() {
	const self = this;
	self.cleanupConn();
	delete self.fcc;
}

// Private

ns.FService.prototype.init = function( fcConf ) {
	const self = this;
	log( 'init //:;;:\\\\', fcConf );
	self.fcc = fcConf;
	self.connect();
	
}

ns.FService.prototype.connect = function() {
	const self = this;
	if ( self.conn )
		self.cleanupConn();
	
	self.conn = new ns.FCWS(
		self.fcc.host,
		self.fcc.wsPort,
		self.fcc.serviceKey,
		self.fcc.serviceName,
		self.fcc.wsProxy,
		self.fcc.useTLS,
	);
	
	self.conn.on( 'open', onOpen );
	self.conn.on( 'error', onError );
	self.conn.on( 'closed', onClosed );
	self.conn.on( 'service', onService );
	
	function onOpen( e ) { self.handleConnOpen(); }
	function onError( e ) { self.handleConnError( e ); }
	function onClosed( e ) { self.handleConnClosed( e ); }
	function onService( e ) {} // log( 'service event', e, 4 ); }
}

ns.FService.prototype.handleConnOpen = function( e ) {
	const self = this;
	//log( 'handleConnOpen', e );
}

ns.FService.prototype.handleConnError = function( err ) {
	const self = this;
	//log( 'handleConnError', err );
}

ns.FService.prototype.handleConnClosed = function( err ) {
	const self = this;
	//log( 'handleConnClosed', err );
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
	const wrap = {
		type : 'service',
		data : event,
	};
	
	return self.conn.send( wrap );
}

ns.FService.prototype.checkString = function( str ) {
	if ( 'string' !== typeof( str ))
		return null;
	
	return str.toString();
}

/*
 standalone somewhat useful logging
*/

/*
const pre = 'Service > ';
function log( msg, obj ) {
	const now = new Date();
	const minutes = now.getMinutes();
	const seconds = now.getSeconds();
	const millis = now.getMilliseconds();
	const time = pad( minutes ) + ':' + pad( seconds ) + ':' + pad( millis, true );
	const message = time + ' : ' + pre + msg;
	if ( obj )
		console.log( message, obj );
	else
		console.log( message );
	
	function pad( arg, millis ) {
		var int = parseInt( arg );
		if ( millis ) {
			if ( int < 10 )
				return '00' + int;
			if ( int < 100 )
				return '0' + int;
		}
		
		if ( int < 10 )
			return '0' + int;
		
		return arg;
	}
}

*/

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
	wsLog( 'boop' );
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
	//wsLog( 'handleAuth', res );
	if ( 0 !== res.status ) {
		//wsLog( 'FCWS.handleAuthenticate - error state', res );
		self.state = 'error';
		self.emitState( 'ERR_AUTHENTICATE' );
		return;
	}
	
	self.state = 'open';
	self.emitState();
	self.sendPing();
}

ns.FCWS.prototype.handleNotify = function( event ) {
	const self = this;
	wsLog( 'handleNotify - you are doing it wrong', event );
}

ns.FCWS.prototype.sendPing = function() {
	const self = this;
	const ping = {
		type : 'ping',
		data : Date.now(),
	};
	self.send( ping );
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
	//wsLog( 'handlePong - NYI', timestamp );
}

ns.FCWS.prototype.connect = function() {
	const self = this;
	if ( self.ws )
		self.cleanupWS();
	
	self.state = 'connecting';
	const subProto = ['FriendService-v1'];
	const opts = {
		rejectUnauthorized : false,
	};
	
	const host = self.buildHost();
	//wsLog( 'host', host );
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
	//wsLog( 'releaseWS' );
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
	//wsLog( 'FCWS.handleClose', code );
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
	//wsLog( 'tryReconnect', self.state );
	if ( 'error' !== self.state ) {
		wsLog( 'tryReconnect - state not error, noop', self.state );
		return;
	}
	
	if ( 'connect-wait' === self.state || 'connecting' === self.state ) {
		wsLog( 'tryReconnect - connecting things already happening, noop' );
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
	//wsLog( 'handleFCEvent - str', msgStr );
	let event = null;
	try {
		event = JSON.parse( msgStr );
	} catch( e ) {
		wsLog( 'handleFCEvent - could not parse event', msgStr );
		return;
	}
	
	if ( !event )
		return;
	
	//wsLog( 'handleFCEvent - obj', event );
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
	
	let err = await send( str );
	if ( err )
		return err;
	else
		return null;
	
	function send( str ) {
		return new Promise(( resolve, reject ) => {
			try {
				//wsLog( 'wssend - str', str );
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

ns.FCWS.prototype.emitState = function( message ) {
	const self = this;
	self.emit( self.state, message || '' );
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

