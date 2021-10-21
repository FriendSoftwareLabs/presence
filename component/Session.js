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

const log = require( './Log' )( 'Session' );
const Emitter = require( './Events' ).Emitter;
const util = require( 'util' );

const ns = {};
ns.Session = function( id, accountId, onclose ) {
	const self = this;
	self.id = id;
	self.accountId = accountId;
	self.onclose = onclose;
	
	self.sessionTimeout = 1000 * 30;
	self.sessionTimer = null;
	self.connections = {};
	self.connIds = [];
	
	Emitter.call( self, eventSink );
	
	self.init();
	
	function eventSink( ...args ) {
		log( 'Session eventSink', args, 3 );
	}
}

util.inherits( ns.Session, Emitter );

// Public

// system attaches a new client connection
ns.Session.prototype.attach = async function( conn ) {
	const self = this;
	if ( !conn )
		return;
	
	if ( self.sessionTimer ) {
		clearTimeout( self.sessionTimer );
		self.sessionTimer = null;
	}
	
	
	const cId = conn.id;
	self.connections[ cId ] = conn;
	self.connIds.push( cId );
	conn.on( 'msg', e => self.handleEvent( e, cId ));
	const ok = await conn.setSession( self.id );
	if ( ok )
		return true;
	
	conn.release( 'msg' );
	delete self.connections[ cId ];
	self.connIds = Object.keys( self.connections );
	return false;
}

// system detaches a ( most likely closed ) client connection
ns.Session.prototype.detach = async function( cid ) {
	const self = this;
	const conn = self.connections[ cid ];
	if ( !conn ) {
		log( 'detach - no conn for cid', cid );
		return null;
	}
	
	await conn.unsetSession();
	conn.release( 'msg' );
	delete self.connections[ cid ];
	self.connIds = Object.keys( self.connections );
	if ( null != self.checkConnsTimeout )
		clearTimeout( self.checkConnsTimeout );
	
	self.checkConnsTimeout = setTimeout( checkConns, 250 );
	
	return conn;
	
	function checkConns() {
		self.checkConns();
	}
}

// account sends events to client(s), clientId is optional
ns.Session.prototype.send = async function( event, clientId ) {
	const self = this;
	let err = null;
	if ( clientId )
		err = await self.sendOnConn( event, clientId );
	else
		err = await self.broadcast( event );
	
	return err;
}

// closes session, either from account( logout ), from lack of client connections
// or from nomansland for whatever reason
ns.Session.prototype.close = async function() {
	const self = this;
	if ( self.checkConnsTimeout )
		clearTimeout( self.checkConnsTimeout );
	
	if ( self.sessionTimer ) {
		clearTimeout( self.sessionTimer );
		self.sessionTimer = null;
	}
	
	const onclose = self.onclose;
	delete self.onclose;
	
	self.emitterClose();
	await self.clearConns();
	
	if ( onclose )
		onclose();
}

// Private

ns.Session.prototype.init = function() {
	const self = this;
	
}

ns.Session.prototype.handleEvent = function( event, clientId ) {
	const self = this;
	self.emit(
		event.type,
		event.data,
		clientId
	);
}

ns.Session.prototype.broadcast = async function( event ) {
	const self = this;
	let errList = await Promise.all( self.connIds.map( await sendTo ));
	return errList;
	
	async function sendTo( cId ) {
		let err = await self.sendOnConn( event, cId );
		return err;
	}
}

ns.Session.prototype.sendOnConn = async function( event, cid ) {
	const self = this;
	const conn = self.connections[ cid ];
	if ( !conn ) {
		log( 'no conn for id', cid );
		return 'ERR_NO_CLIENT';
	}
	
	const err = await conn.send( event );
	//let err = await send( event, conn );
	return err;
	
	/*
	function send( event, conn ) {
		return new Promise(( resolve, reject ) => {
			conn.send( event, sendBack );
			function sendBack( err ) {
				resolve( err || null );
			}
		});
	}
	*/
	//conn.send( event, callback );
}

ns.Session.prototype.checkConns = function() {
	const self = this;
	self.checkConnsTimeout = null
	if ( self.connIds.length )
		return;
	
	self.close();
	/*
	self.sessionTimer = setTimeout( sessionTimedOut, self.sessionTimeout );
	function sessionTimedOut() {
		self.sessionTimer = null;
		self.close();
	}
	*/
}

ns.Session.prototype.clearConns = async function() {
	const self = this;
	const closing = self.connIds.map( unsetSession );
	await Promise.all( closing );
	self.connIds.forEach( close );
	self.connections = {};
	self.connIds = [];
	
	function unsetSession( cId ) {
		const conn = self.connections[ cId ];
		if ( !conn )
			return;
		
		return conn.unsetSession();
	}
	
	function close( cId ) {
		const conn = self.connections[ cId ];
		if ( !conn )
			return;
		
		try{
			conn.close();
		} catch( ex ) {
			
		}
	}
}

module.exports = ns.Session;
