'use strict';

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

const log = require( './Log')( 'Client' );
const Emitter = require( './Events' ).Emitter;
const uuid = require( './UuidPrefix' )();
const util = require( 'util' );

var ns = {};

ns.TCPClient = function( tcpSocket ) {
	if ( !( this instanceof ns.TCPClient ))
		return new p.Client( tcpSocket );
	
	const self = this;
	Emitter.call( self );
	self.id = null;
	self.socket = tcpSocket;
	
	self.rcvBuffer = [];
	self.sessionTimeout = 1000 * 60;
	self.pingStepTimeout = 1000 * 10;
	self.pingStep = 1000 * 2;
	self.pingTimeoutId = null;
	self.closeTimeoutId = null;
	self.pings = [];
	
	self.init();
}

// Public

/*
	Emitter provides an event interface
	.on
	.once
	.off
	.release
*/
util.inherits( ns.TCPClient, Emitter );

ns.TCPClient.prototype.send = function( msg, callback ) {
	const self = this;
	var wrap = {
		type : 'msg',
		data : msg,
	};
	self.sendOnSocket( wrap, callback );
}

ns.TCPClient.prototype.setSession = function( sid, callback ) {
	const self = this;
	if ( sid )
		self.sessionId = sid;
	
	var set = {
		type : 'session',
		data : self.sessionId,
	};
	self.sendCon( set, callback );
}

ns.TCPClient.prototype.unsetSession = function( callback ) {
	const self = this;
	self.sessionId = null;
	var unset = {
		type : 'session',
		data : null,
	};
	self.sendCon( unset, callback );
}

ns.TCPClient.prototype.close = function() {
	const self = this;
	self.clearTimeouts();
	if ( self.socket ) {
		self.releaseSocket();
		self.socket.destroy();
	}
	
	self.release();
	delete self.socket;
}

// Private

ns.TCPClient.prototype.init = function() {
	const self = this;
	self.id = uuid.get( 'client' );
	self.connMap = {
		'session' : session,
		'ping'    : ping,
		'pong'    : pong,
	};
	
	self.bindSocket();
	self.startPing();
	
	function session( e ) { self.handleSession( e ); }
	function ping( e ) { self.handlePing( e ); }
	function pong( e ) { self.handlePong( e ); }
}

ns.TCPClient.prototype.bindSocket = function() {
	const self = this;
	if ( !self.socket ) {
		self.kill();
		return;
	}
	
	self.socket.on( 'error', onError );
	self.socket.on( 'close', onClose );
	self.bindSocketData();
	
	function onError( e ) { self.handleSocketError( e ); }
	function onClose( e ) { self.handleSocketClose( e ); }
}

ns.TCPClient.prototype.bindSocketData = function() {
	const self = this;
	self.socket.on( 'data', onData );
	function onData( e ) { self.handleSocketData( e ); }
}

ns.TCPClient.prototype.releaseSocket = function() {
	const self = this;
	if ( !self.socket )
		return;
	
	self.socket.removeAllListeners();
	self.socket.on( 'error', () => {});
}

ns.TCPClient.prototype.startPing = function() {
	const self = this;
	self.pingIntervalId = setInterval( sendPing, self.pingStep );
	function sendPing() { self.sendPing(); }
}

ns.TCPClient.prototype.sendPing = function() {
	const self = this;
	if ( !self.pingIntervalId )
		return;
	
	const now = Date.now();
	const ping = {
		type : 'ping',
		data : now,
	};
	self.sendCon( ping );
	self.pings[ now ] = setTimeout( pingStepTimedout, self.pingStepTimeout ); // d
	function pingStepTimedout() {
		self.startPingTimeout();
	}
}

ns.TCPClient.prototype.handlePong = function( timestamp ) {
	const self = this;
	if ( self.pingTimeoutId )
		self.clearPingTimeout();
	
	const timeoutId = self.pings[ timestamp ];
	if ( null == timeoutId )
		return;
	
	clearTimeout( timeoutId );
	delete self.pings[ timestamp ];
	const then = +timestamp;
	const now = Date.now();
	const pingtime = now - then;
}

ns.TCPClient.prototype.startPingTimeout = function() {
	const self = this;
	if ( self.pingTimeoutId )
		return;
	
	self.stopPing();
	self.pingTimeoutId = setTimeout( pingTimeout, self.sessionTimeout );
	function pingTimeout() {
		self.kill();
	}
}

ns.TCPClient.prototype.clearPingTimeout = function() {
	const self = this;
	if ( !self.pingTimeoutId )
		return;
	
	clearTimeout( self.pingTimeoutId );
	self.pingTimeoutId = null;
}

ns.TCPClient.prototype.stopPing = function() {
	const self = this;
	if ( self.pingIntervalId )
		clearInterval( self.pingIntervalId );
	
	for( const pingId in self.pings ) {
		const timeoutId = self.pings[ pingId ];
		clearTimeout( timeoutId );
	}
	
	self.pings = {};
}

ns.TCPClient.prototype.clearTimeouts = function() {
	const self = this;
	if ( self.closeTimeoutId )
		clearTimeout( self.closeTimeoutId );
	
	self.clearPingTimeout();
	self.stopPing();
}

ns.TCPClient.prototype.handleSocketError = function( e ) {
	const self = this;
	log( 'socketError', e );
	self.handleClosed();
}

ns.TCPClient.prototype.handleSocketClose = function( e ) {
	const self = this;
	log( 'socketClose', e );
	self.handleClosed();
}

ns.TCPClient.prototype.handleClosed = function() {
	const self = this;
	if ( self.closeTimeoutId )
		return;
	
	if ( self.pingTimeoutId )
		return;
	
	self.stopPing();
	self.kill();
	/*
	self.closeTimeoutId = setTimeout( closeTimeout, self.sessionTimeout );
	function closeTimeout() {
		self.closeTimeoutId = null;
		self.kill();
	}
	*/
}

ns.TCPClient.prototype.kill = function() {
	const self = this;
	self.emit( 'close', null );
}

ns.TCPClient.prototype.handleSocketData = function( str ) {
	const self = this;
	//log( 'handleSocketData', shtStr( str ));
	let event = parse( str );
	if ( event )
		self.rcvBuffer = [];
	else {
		//log( 'buff part, l: ', str.length );
		self.rcvBuffer.push( str );
	}
	
	if ( 1 < self.rcvBuffer.length )
		event = tryBuffer();
	
	if ( !event )
		return;
	
	if ( 'msg' === event.type ) {
		const notEmitted = self.emit( event.type, event.data );
		if ( notEmitted )
		log( 'msg - notEmitted', notEmitted, 3 );
		return;
	}
	
	self.handleConnMsg( event );
	
	function tryBuffer() {
		//log( 'tryBuffer', self.rcvBuffer.map( str => shtStr( str )));
		const buffStr = self.rcvBuffer.join( '' );
		//log( 'buffStr', shtStr( buffStr ) );
		const event = parse( buffStr );
		if ( !event ) {
			//log( 'tryBuffer - failed', buffStr );
			return null;
		}
		
		//log( 'tryBuffer - parsed', event );
		self.rcvBuffer = [];
		return event;
	}
	
	function parse( str ) {
		let event = null;
		try {
			event = JSON.parse( str );
		} catch( e ) {
			//log( 'could not parse', shtStr( str ));
			return null;
		}
		
		return event;
	}
	
	function shtStr( str ) {
		let sht = str.slice( 0, 8 ) + '...' + str.slice( -8 );
		return sht;
	}
}

ns.TCPClient.prototype.handleConnMsg = function( event ) {
	const self = this;
	const handler = self.connMap[ event.type ];
	if ( !handler ) {
		const noHandler = self.emit( event.type, event.data );
		if ( noHandler )
			log( 'handleConnMsg - no handler for', noHandler );
		return;
	}
	
	handler( event.data );
}

ns.TCPClient.prototype.handleSession = function( sessionId ) { 
	const self = this;
	if ( !sessionId )
		self.kill();
	else
		self.emit( 'session', sessionId );
}

ns.TCPClient.prototype.handlePing = function( timestamp ) { 
	const self = this;
	const pong = {
		type : 'pong',
		data : timestamp,
	};
	self.sendCon( pong );
}

ns.TCPClient.prototype.sendCon = function( msg, callback ) {
	const self = this;
	self.sendOnSocket( msg, callback );
}

ns.TCPClient.prototype.sendOnSocket = function( msg, callback ) {
	const self = this;
	if ( !self.socket ) {
		if ( callback )
			callback( 'ERR_NO_SOCKET' );
		return;
	}
	
	var str = null;
	try {
		str = JSON.stringify( msg );
	} catch( e ) {
		log( 'sendOnSocket - failed to string', msg );
		return;
	}
	
	self.writeToSocket( str, callback );
}

ns.TCPClient.prototype.writeToSocket = function( msg, callback ) {
	const self = this;
	if ( !self.socket || self.socket.destroyed ) {
		if ( callback )
			callback( true );
		return;
	}
	
	try {
		self.socket.write( msg, callback );
	} catch( e ) {
		log( 'tcpClient.writeToSocket err', e.stack || e );
		if ( callback )
			callback( e );
	}
}


// WebSocket Client

ns.WSClient = function( wsSocket ) {
	const self = this;
	ns.TCPClient.call( self, wsSocket );
}

util.inherits( ns.WSClient, ns.TCPClient );

// Public

ns.WSClient.prototype.close = function() {
	const self = this;
	if ( self.socket ) {
		self.releaseSocket();
		self.socket.close();
	}
	
	self.release();
	delete self.socket;
}

// private

ns.WSClient.prototype.bindSocketData = function() {
	const self = this;
	self.socket.on( 'message', msg );
	function msg( e ) { self.handleSocketData( e ); }
}

ns.WSClient.prototype.writeToSocket = function( msg, callback ) {
	const self = this;
	if ( !self.socket )
		return;
	
	try {
		self.socket.send( msg, callback );
	} catch( e ) {
		log( 'wsClient.writeToSocket err', e.stack || e );
		if ( callback )
			callback( e );
	}
}

module.exports = ns;
