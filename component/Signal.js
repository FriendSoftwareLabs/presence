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

const log = require( './Log')( 'signal' );
const Emitter = require( './Events' ).Emitter;
const util = require( 'util' );

var ns = {};

ns.Signal = function( conf ) {
	const self = this;
	self.roomId = conf.roomId;
	self.roomName = conf.roomName;
	self.isPrivate = conf.isPrivate;
	self.persistent = conf.persistent;
	self.clientId = conf.clientId;
	self.name = conf.name;
	self.avatar = conf.avatar;
	self.isOwner = conf.isOwner;
	self.isAdmin = conf.isAdmin;
	self.isAuthed = conf.isAuthed;
	self.isGuest = conf.isGuest;
	self.workgroups = conf.workgroups;
	
	Emitter.call( self );
	
	self.subs = {};
	self.peers = {};
	
	self.toRoomQueue = [];
	self.toAccountQueue = [];
	
	self.init();
}

util.inherits( ns.Signal, Emitter );

// Room interface

ns.Signal.prototype.send = function( event ) {
	const self = this;
	if ( !self.emitToAccount ) {
		self.toAccountQueue.push( event );
		return;
	}
	
	self.emitToAccount( event );
}

ns.Signal.prototype.setRoomPersistent = function( isPersistent, name ) {
	const self = this;
	self.persistent = isPersistent;
	self.roomName = name;
	const persistent = {
		type : 'persistent',
		data : {
			persistent : isPersistent,
			name       : name,
		},
	};
	self.send( persistent );
}

ns.Signal.prototype.setIsAuthed = function( isAuthed ) {
	const self = this;
	self.isAuthed = isAuthed;
	const authed = {
		type : 'authed',
		data : {
			userId   : self.accountId,
			worgId   : null,
			isAuthed : isAuthed,
		},
	};
	self.send( authed );
}

ns.Signal.prototype.close = function() {
	const self = this;
	const onclose = self.onclose;
	
	self.toRoomQueue = [];
	self.toAccountQueue = [];
	
	delete self.onclose;
	delete self.roomId;
	delete self.accountId;
	delete self.emitToAccount;
	
	if ( onclose )
		onclose();
}

// Account interface

ns.Signal.prototype.toRoom = function( event ) {
	const self = this;
	self.emitToRoom( event );
}

ns.Signal.prototype.setIdentity = function( identity ) {
	const self = this;
	const id = {
		type : 'identity',
		data : identity,
	};
	self.emitToRoom( id );
}

// go offline ( ex: when account closes )
ns.Signal.prototype.disconnect = function() {
	const self = this;
	const dis = { type : 'disconnect', };
	self.emitToRoom( dis );
}

// Are you sure you want to .leave()? You might be looking for .disconnect()..
// removes user from room / authorizations
ns.Signal.prototype.leave = function() {
	const self = this;
	const leave = { type : 'leave', };
	self.emitToRoom( leave );
}

// account sets callback for events from room
ns.Signal.prototype.setToAccount = function( fn ) {
	const self = this;
	self.emitToAccount = fn;
	if ( !self.toAccountQueue.length )
		return;
	
	self.toAccountQueue.forEach( emit );
	self.toAccountQueue = [];
	
	function emit( event ) { self.emitToAccount( event ); }
}

ns.Signal.prototype.setOnclose = function( fn ) {
	const self = this;
	self.onclose = fn;
}

// Private

ns.Signal.prototype.init = function() {
	const self = this;
	/*
	log( 'account<->room bridge nominal..', {
		rid : self.roomId,
		aid : self.accountId,
	});
	*/
}

ns.Signal.prototype.emitToRoom = function( event ) {
	const self = this;
	const unknown = self.emit( event.type, event.data );
	if ( unknown )
		log( 'emitToRoom - unknown', unknown, 4 );
}

/*
Rooms account interface
*/

ns.AccountProxy = function( account, roomId ) {
	const self = this;
	self.id = account.id;
	self.account = account;
	self.roomId = roomId;
	
	self.init();
}

// Public

ns.AccountProxy.prototype.close = function() {
	const self = this;
	delete self.id;
	delete self.account;
	delete self.roomId;
}

ns.AccountProxy.prototype.send = function( event ) {
	const self = this;
	self.account.handleRoomEvent( event, self.roomId );
}

ns.AccountProxy.prototype.isAdmin = function() {
	const self = this;
	return self.account.isAdmin;
}

// Private

ns.AccountProxy.prototype.init = function() {
	const self = this;
}

/*
Accounts room interface
*/

ns.RoomProxy = function( room, accountId ) {
	const self = this;
	self.id = room.id;
	self.room = room;
	self.accId = accountId;
	
	self.init();
}

// Public

ns.RoomProxy.prototype.close = function() {
	const self = this;
	delete self.id;
	delete self.room;
	delete self.accId;
}

ns.RoomProxy.prototype.send = function( event ) {
	const self = this;
	self.room.handleUserEvent( event, self.accId );
}

// Private

ns.RoomProxy.prototype.init = function() {
	const self = this;
}

module.exports = ns.Signal;
