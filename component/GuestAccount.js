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

const log = require( './Log' )( 'GuestAccount' );

const ns = {};
ns.GuestAccount = function( conf, session, roomCtrl ) {
	const self = this;
	self.id = conf.id;
	self.roomId = conf.roomId;
	self.identity = conf.identity;
	self.session = session;
	self.roomCtrl = roomCtrl;
	
	self.room = null;
	self.initialized = false;
	
	self.init();
}

// Public

ns.GuestAccount.prototype.close = function() {
	const self = this;
	self.logout();
	
	const session = self.session;
	delete self.session;
	delete self.roomId;
	delete self.identity;
	delete self.roomCtrl;
	
	if ( session && session.close )
		session.close();
}

// private

ns.GuestAccount.prototype.init = function() {
	const self = this;
	self.identity.clientId = self.id;
	self.session.on( 'initialize', init );
	self.session.on( 'join', join );
	function init( e, cid ) { self.handleInitialize( e, cid ); }
	function join( e ) { self.joinRoom(); }
}

ns.GuestAccount.prototype.handleInitialize = function( e, clientId ) {
	const self = this;
	const init = {
		type : 'initialize',
		data : {
			account  : {
				clientId : self.id,
				name     : self.identity.name,
			},
			rooms    : [ self.roomId ],
		},
	};
	self.session.send( init, clientId );
	
	if ( self.initialized )
		return;
	
	self.initalized = true;
	self.joinRoom();
}

ns.GuestAccount.prototype.joinRoom = function() {
	const self = this;
	const guestAcc = {
		clientId : self.id,
		name     : self.identity.name,
	};
	
	self.roomCtrl.guestJoinRoom( guestAcc, self.roomId, roomBack );
	function roomBack( room ) {
		self.room = room;
		if ( !self.room ) {
			self.logout();
			return;
		}
		
		log( 'guestacc identity', self.identity );
		self.room.setIdentity( self.identity );
		const join = {
			type : 'join',
			data : {
				clientId : self.room.roomId,
				name     : self.room.roomName,
			},
		};
		self.session.send( join, sendBack );
		function sendBack() { self.bind(); }
	}
}

ns.GuestAccount.prototype.bind = function() {
	const self = this;
	const rid = self.room.roomId;
	self.session.on( rid, fromClientToRoom );
	self.room.setOnclose( onClose );
	self.room.setToAccount( fromRoom );
	self.room.setIdentity( self.identity );
	function fromClientToRoom( e ) { self.handleClientEvent( e ); }
	function fromRoom( e ) { self.handleRoomEvent( e, rid ); }
	function onClose( e ) { self.handleRoomClosed( rid ); }
}

ns.GuestAccount.prototype.handleRoomEvent = function( event ) {
	const self = this;
	if ( !self.session )
		return;
	
	const wrap = {
		type : self.roomId,
		data : event,
	};
	self.session.send( wrap );
}

ns.GuestAccount.prototype.handleClientEvent = function( event ) {
	const self = this;
	if ( !self.room )
		return;
	
	self.room.toRoom( event );
}

ns.GuestAccount.prototype.handleRoomClosed = function() {
	const self = this;
	self.close();
}


ns.GuestAccount.prototype.logout = function() {
	const self = this;
	if ( self.room )
		self.room.leave();
	
	delete self.room;
}

module.exports = ns.GuestAccount;
