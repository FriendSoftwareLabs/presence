'use strict';

/*©agpl*************************************************************************
*                                                                              *
* Friend Unifying Platform                                                     *
* ------------------------                                                     *
*                                                                              *
* Copyright 2014-2016 Friend Software Labs AS, all rights reserved.            *
* Hillevaagsveien 14, 4016 Stavanger, Norway                                   *
* Tel.: (+47) 40 72 96 56                                                      *
* Mail: info@friendos.com                                                      *
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
