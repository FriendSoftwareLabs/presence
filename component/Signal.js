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
	self.persistent = conf.persistent;
	self.accountId = conf.accountId;
	self.accountName = conf.accountName;
	self.avatar = conf.avatar;
	self.owner = conf.owner;
	self.admin = conf.admin;
	self.authed = conf.authed;
	self.guest = conf.guest;
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
	self.authed = isAuthed;
	const authed = {
		type : 'authed',
		data : {
			userId   : self.accountId,
			worgId   : null,
			authed   : isAuthed,
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

module.exports = ns.Signal;
