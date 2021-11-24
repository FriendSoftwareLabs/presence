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

'use strict';

const uuid = require( './UuidPrefix' )( 'msg' );
const events = require( './Events' );
const WebRTCProxy = require( './WebRTCProxy' );
const dFace = require( './DFace' );
const Janus = require( '../janus/Janus' );
const util = require( 'util' );

var ns = {};

const uLog = require( './Log' )( 'Room > Users' );
ns.Users = function(
	dbPool,
	roomId,
	isPersistent
) {
	const self = this;
	events.Emitter.call( self );
	
	self.isPersistent = isPersistent;
	self.roomId = roomId;
	self.workId = null;
	self.superId = null;
	
	self.everyone = {};
	self.everyId = [];
	self.atNames = [];
	self.atNameRemoveList = [];
	self.notPersisted = [];
	self.online = [];
	self.active = [];
	self.authorized = [];
	self.admins = [];
	self.guests = [];
	self.worgs = {};
	self.wIds = [];
	self.subs = {};
	self.subIds = [];
	self.viewGroups = [];
	self.viewers = {};
	self.viewerIds = [];
	self.lastRead = {};
	self.recent = {};
	self.recentIds = [];
	self.recentTrimInterval = null;
	self.recentTrimMS = 1000 * 60 * 10;
	self.recentMaxMS = 1000 * 60 * 60 * 8;
	
	self.init( dbPool );
}

util.inherits( ns.Users, events.Emitter );

ns.Users.prototype.initialize = async function() {
	const self = this;
	let users = null;
	try {
		users = await self.msgDb.loadRoomUserMessages();
	} catch( e ) {
		uLog( 'loadUserLastRead - db err', e );
		return;
	}
	
	if ( !users || !users.length ) {
		return;
	}
	
	users.forEach( user => {
		const uId = user.userId;
		self.lastRead[ uId ] = true;
	});
}

// Public

ns.Users.prototype.set = async function( user ) {
	const self = this;
	const cId = user.clientId;
	if ( !cId ) {
		try {
			throw new Error( 'not a real user' );
		} catch ( e ) {
			uLog( 'set - not a real user', e.stack || e );
		}
		return false;
	}
	
	if ( user.isGuest )
		self.setGuest( cId );
	
	let curr = self.get( cId );
	if ( null == curr ) {
		let isRegged = self.checkIsRegistered( cId );
		if ( !isRegged && self.isPersistent ) {
			deny( user );
			return false;
		}
	}
	
	self.everyone[ cId ] = user;
	
	await self.addLastRead( cId );
	const uIdx = self.everyId.indexOf( cId );
	if ( -1 === uIdx )
		self.everyId.push( cId );
	
	if ( user.isAdmin )
		self.setAdmin( cId );
	
	self.addAtName( cId );
	
	return true;
	
	function deny( user ) {
		uLog( 'set - user not set', {
			r     : {
				wid : self.workId,
				rid : self.roomId,
			},
			user  : {
				cid  : user.clientId,
				name : user.name,
			},
			users : self.everyId,
			auth  : self.authorized,
			worgs : self.worgs,
		}, 4 );
		try {
			throw new Error( 'Users.set - not set' );
		} catch ( e ) {
			uLog( 'set - deny', e.stack || e );
		}
	}
}

ns.Users.prototype.exists = function( userId ) {
	const self = this;
	return !!self.everyone[ userId ];
}

ns.Users.prototype.get = function( userId ) {
	const self = this;
	return self.everyone[ userId ];
}

ns.Users.prototype.getList = function( workgroupId ) {
	const self = this;
	if ( workgroupId )
		return self.getListForWorg( workgroupId );
	
	return self.everyId;
}

ns.Users.prototype.remove = function( userId ) {
	const self = this;
	const user = self.everyone[ userId ];
	if ( !user )
		return;
	
	self.setActive( false, userId );
	self.setOffline( userId );
	if ( user.isAdmin )
		self.removeAdmin( userId );
	
	delete self.everyone[ userId ];
	const uIdx = self.everyId.indexOf( userId );
	if ( -1 !== uIdx )
		self.everyId.splice( uIdx, 1 );
	
	const aIdx = self.authorized.indexOf( userId );
	if ( -1 !== aIdx ) {
		self.authorized.splice( aIdx, 1 );
		return user;
	}
	
	const gIdx = self.guests.indexOf( userId );
	if ( -1 !== gIdx ) {
		self.guests.splice( gIdx, 1 );
		return user;
	}
	
	const removedFromWorg = self.wIds.some( wId => {
		const worg = self.worgs[ wId ];
		const uIdx = worg.indexOf( userId );
		if ( -1 === uIdx )
			return false;
		
		worg.splice( uIdx, 1 );
		return true;
	});
	
	self.removeAtName( user.name );
	
	if ( removedFromWorg ) {
		self.updateViewMembers();
		return user;
	}
	
	//uLog( 'remove - not found in things', userId );
	return null;
}

ns.Users.prototype.setActive = function( isActive, userId ) {
	const self = this;
	if ( !self.everyone[ userId ])
		return;
	
	const uIdx = self.active.indexOf( userId );
	if ( isActive )
		set( userId, uIdx );
	else
		unset( userId, uIdx );
	
	function set( uId, uIdx ) {
		if ( -1 !== uIdx )
			return;
		
		self.active.push( uId );
	}
	
	function unset( uId, uIdx ) {
		if ( -1 === uIdx )
			return;
		
		self.active.splice( uIdx, 1 );
	}
}

ns.Users.prototype.getActive = function() {
	const self = this;
	return self.active;
}

ns.Users.prototype.setRecent = function( userId ) {
	const self = this;
	if ( !self.everyone[ userId ])
		return;
	
	const add = !self.recent[ userId ];
	self.recent[ userId ] = Date.now();
	if ( !add )
		return;
	
	self.recentIds.push( userId );
	const uptd = {
		type : 'recent-add',
		data : userId,
	};
	self.broadcast( null, uptd );
}

ns.Users.prototype.getRecent = function() {
	const self = this;
	return self.recentIds;
}

ns.Users.prototype.removeRecent = function( userId ) {
	const self = this;
	delete self.recent[ userId ];
	const idx = self.recentIds.indexOf( userId );
	if ( -1 == idx )
		return;
	
	self.recentIds.splice( idx, 1 );
	const uptd = {
		type : 'recent-remove',
		data : userId,
	};
	self.broadcast( null, uptd );
}

ns.Users.prototype.setAdmin = function( userId, isIdUpdate ) {
	const self = this;
	const aIdx = self.admins.indexOf( userId );
	if ( -1 != aIdx )
		return;
	
	self.admins.push( userId );
	if ( !isIdUpdate )
		return;
	
	const add = {
		type : 'admin-add',
		data : userId,
	};
	self.broadcast( null, add );
}

ns.Users.prototype.removeAdmin = function( userId, isIdUpdate ) {
	const self = this;
	const idx = self.admins.indexOf( userId );
	if ( -1 == idx )
		return;
	
	self.admins.splice( idx, 1 );
	if ( !isIdUpdate )
		return;
	
	const remove = {
		type : 'admin-remove',
		data : userId,
	};
	self.broadcast( null, remove );
}

ns.Users.prototype.getAdmins = function() {
	const self = this;
	return self.admins;
}

ns.Users.prototype.addAtName = function( userId, isIdUpdate ) {
	const self = this;
	const name = self.checkAddToAtList( userId );
	if ( null == name )
		return;
	
	self.atNames.push( name );
	if ( isIdUpdate )
		return;
	
	const add = {
		type : 'at-add',
		data : name,
	};
	self.broadcast( null, add );
}

ns.Users.prototype.checkAddToAtList = function( userId ) {
	const self = this;
	const user = self.get( userId );
	if ( null == user ) {
		uLog( 'checkAddToAtList - no user was found for', userId );
		return;
	}
	
	const name = user.name;
	const nIdx = self.atNames.indexOf( name );
	if ( -1 != nIdx )
		return;
	
	return name;
}

ns.Users.prototype.removeAtName = function( name ) {
	const self = this;
	self.atNameRemoveList.push( name );
	if ( null != self.removeAtNameTimeout )
		return;
	
	self.removeAtNameTimeout = setTimeout( doRemove, 1000 * 2 );
	
	function doRemove() {
		self.removeAtNameTimeout = null;
		self.doAtNameUpdate();
	}
}

ns.Users.prototype.doAtNameUpdate = function() {
	const self = this;
	self.atNameRemoveList = [];
	const names = {};
	self.everyId.forEach( uId => {
		const name = self.checkAddToAtList( uId );
		if ( null == name )
			return;
		
		names[ name ] = true;
	});
	self.atNames = Object.keys( names );
	const uptd = {
		type : 'at-names',
		data : self.atNames,
	};
	self.broadcast( null, uptd );
}

ns.Users.prototype.getAtNames = function() {
	const self = this;
	return self.atNames;
}

ns.Users.prototype.setOnline = function( userId ) {
	const self = this;
	const user = self.get( userId );
	if ( !user || !user.close ) {
		uLog( 'setOnline - no user or not real', userId );
		return null;
	}
	
	if ( self.online.some( oId => oId === userId ))
		return user;
	
	self.online.push( userId );
	return user;
}

ns.Users.prototype.setOffline = function( userId ) {
	const self = this;
	const userIndex = self.online.indexOf( userId );
	if ( -1 === userIndex )
		return false;
	
	self.online.splice( userIndex, 1 );
	return true;
}

ns.Users.prototype.getOnline = function() {
	const self = this;
	return self.online;
}

ns.Users.prototype.addAuthorized = function( userId ) {
	const self = this;
	if ( self.checkIsAuthed( userId ))
		return true;
	
	self.authorized.push( userId );
	const user = self.get( userId );
	if ( !user || !user.setIsAuthed )
		return false;
	
	user.setIsAuthed( true );
}

ns.Users.prototype.checkIsAuthed = function( userId ) {
	const self = this;
	return self.authorized.some( uId => uId === userId );
}

ns.Users.prototype.getAuthorized = function() {
	const self = this;
	return self.authorized;
}

ns.Users.prototype.removeAuth = function( userId ) {
	const self = this;
	const aIdx = self.authorized.indexOf( userId );
	if ( -1 === aIdx )
		return;
	
	self.authorized.splice( aIdx, 1 );
	const user = self.get( userId );
	if ( !user || !user.setIsAuthed )
		return false;
	
	user.setIsAuthed( false );
}

ns.Users.prototype.addForWorkgroup = function( worgId, userId ) {
	const self = this;
	if ( !self.worgs[ worgId ]) {
		self.worgs[ worgId ] = [];
		self.wIds.push( worgId );
	}
	
	const worg = self.worgs[ worgId ];
	const uIdx = worg.indexOf( userId );
	if ( -1 !== uIdx )
		return false;
	
	worg.push( userId );
	self.updateViewMembers();
	return true;
}

ns.Users.prototype.getWorgsFor = function( userId ) {
	const self = this;
	const memberOf = [];
	self.wIds.forEach( worgId => {
		const worg = self.worgs[ worgId ];
		if ( !worg.some( uId => uId === userId ))
			return;
		
		memberOf.push( worgId );
	});
	
	return memberOf;
}

ns.Users.prototype.getListForWorg = function( worgId ) {
	const self = this;
	return self.worgs[ worgId ] || [];
}

ns.Users.prototype.checkIsMemberOf = function( userId, worgId ) {
	const self = this;
	const members = self.worgs[ worgId ];
	if ( null == worgId )
		console.trace( 'checkIsMemberOf', [ userId, worgId ]);
	
	if ( !members || !members.length )
		return false;
	
	return members.some( mId => mId === userId );
}

ns.Users.prototype.removeFromWorg = function( worgId, userId ) {
	const self = this;
	const worg = self.worgs[ worgId ];
	if ( !worg || !worg.length )
		return;
	
	const uIdx = worg.indexOf( userId );
	if ( -1 === uIdx )
		return;
	
	worg.splice( uIdx, 1 );
	self.updateViewMembers();
}

ns.Users.prototype.removeWorg = function( worgId ) {
	const self = this;
	delete self.worgs[ worgId ];
	self.wIds = Object.keys( self.worgs );
	self.updateViewMembers();
}

ns.Users.prototype.setGuest = function( userId ) {
	const self = this;
	const gIdx = self.guests.indexOf( userId );
	if ( -1 != gIdx )
		return;
	
	self.guests.push( userId );
}

ns.Users.prototype.getGuests = function() {
	const self = this;
	return self.guests;
}

ns.Users.prototype.setSuper = function( roomInfo ) {
	const self = this;
	self.super = roomInfo;
}

ns.Users.prototype.getSuper = function() {
	const self = this;
	if ( !self.super )
		return null;
	
	return self.super.workId || null;
}

ns.Users.prototype.getSuperRoom = function() {
	const self = this;
	return self.super.clientId;
}

ns.Users.prototype.addSub = function( worgId ) {
	const self = this;
	if ( self.subs[ worgId ])
		return;
	
	self.subs[ worgId ] = true;
	self.subIds.push( worgId );
}

ns.Users.prototype.getSubs = function() {
	const self = this;
	return self.subIds || [];
}

ns.Users.prototype.getSubsFor = function( userId ) {
	const self = this;
	const wgs = self.getWorgsFor( userId );
	if ( !wgs || !wgs.length )
		return [];
	
	const sgs = wgs.filter( wId => {
		return !!self.subs[ wId ];
	});
	return sgs;
}

ns.Users.prototype.removeSub = function( worgId ) {
	const self = this;
	const sIdx = self.subIds.indexOf( worgId );
	if ( -1 === sIdx )
		return;
	
	delete self.subs[ worgId ];
	self.subIds.splice( sIdx, 1 );
}

ns.Users.prototype.addViewGroup = function( worgId ) {
	const self = this;
	if ( self.viewGroups.some( vId => vId === worgId ))
		return;
	
	self.viewGroups.push( worgId );
	self.updateViewMembers();
}

ns.Users.prototype.checkIsViewer = function( userId ) {
	const self = this;
	return !!self.viewers[ userId ];
}

ns.Users.prototype.getViewer = function( userId ) {
	const self = this;
	if ( !self.viewers[ userId ])
		return null;
	
	return self.everyone[ userId ] || null;
}

ns.Users.prototype.getViewerList = function() {
	const self = this;
	return self.viewerIds;
}

ns.Users.prototype.removeViewGroup = function( worgId ) {
	const self = this;
	wIndex = self.viewGroups.indexOf( worgId );
	if ( -1 === wIndex )
		return;
	
	self.viewGroups.splice( wIndex, 1 );
	self.updateViewMembers();
}

ns.Users.prototype.setPersistent = function( isPersistent ) {
	const self = this;
	self.isPersistent = !!isPersistent;
}

ns.Users.prototype.send = function( targetId, event ) {
	const self = this;
	self._send( targetId, event );
}

ns.Users.prototype.broadcast = function( targets, event, source, wrapInSource ) {
	const self = this;
	self._broadcast( targets, event, source, wrapInSource );
}

ns.Users.prototype.sendChat = function( targetId, event ) {
	const self = this;
	const chat = {
		type : 'chat',
		data : event,
	};
	self._send( targetId, chat );
}

ns.Users.prototype.broadcastChat = function( targetList, event, sourceId, wrapInSource ) {
	const self = this;
	const chat = {
		type : 'chat',
		data : event,
	};
	
	self._broadcast( targetList, chat, sourceId, wrapInSource );
}

ns.Users.prototype.sendLive = function( targetId, event ) {
	const self = this;
	const live = {
		type : 'live',
		data : event,
	};
	self._send( targetId, live );
}

ns.Users.prototype.broadcastLive = function( targetList, event, sourceId, wrapInSource ) {
	const self = this;
	const live = {
		type : 'live',
		data : event,
	};
	self._broadcast( targetList, live, sourceId, wrapInSource );
}

ns.Users.prototype.sendInvite = function( targetId, event ) {
	const self = this;
	const invite = {
		type : 'invite',
		data : event,
	};
	self._send( targetId, invite );
}

ns.Users.prototype.broadcastInvite = function( targetList, event, sourceId, wrapInSource ) {
	const self = this;
	const invite = {
		type : 'invite',
		data : event,
	};
	self._broadcast( targetList, invite, sourceId, wrapInSource );
}

ns.Users.prototype.sendWorg = function( targetId, event ) {
	const self = this;
	const worg = {
		type : 'workgroup',
		data : event,
	};
	self._send( targetId, worg );
}

ns.Users.prototype.broadcastWorg = function( targetList, event, sourceId, wrapInSource ) {
	const self = this;
	const worg = {
		type : 'workgroup',
		data : event,
	};
	self._broadcast( targetList, worg, sourceId, wrapInSource );
}

ns.Users.prototype.sendSettings = function( targetId, event ) {
	const self = this;
	const sett = {
		type : 'settings',
		data : event,
	};
	self._send( targetId, sett );
}

ns.Users.prototype.broadcastSettings = function( targetList, event, sourceId, wrapInSource ) {
	const self = this;
	const sett = {
		type : 'settings',
		data : event,
	};
	self._broadcast( targetList, sett, sourceId, wrapInSource );
}

ns.Users.prototype.close = function() {
	const self = this;
	if ( null != self.recentTrimInterval ) {
		clearInterval( self.recentTrimInterval );
		self.recentTrimInterval = null;
	}
	
	self.everyId.forEach( uId => {
		const user = self.everyone[ uId ];
		delete self.everyone[ uId ];
		if ( !user || !user.close )
			return;
		
		user.close();
	});
	
	self.viewerIds.forEach( vId => {
		const viewer = self.everyone[ vId ];
		delete self.everyone[ vId ];
		if ( !user || !user.close )
			return;
		
		user.close();
	});
	
	if ( null != self.removeAtNameTimeout )
		clearTimeout( self.removeAtNameTimeout );
	self.removeAtNameTimeout = null;
	
	if ( self.msgDb )
		self.msgDb.close();
	
	delete self.msgDb;
	delete self.lastRead;
}

// Private

ns.Users.prototype.init = function( dbPool ) {
	const self = this;
	self.msgDb = new dFace.MessageDB( dbPool, self.roomId );
	self.startTrimRecentInterval();
}

ns.Users.prototype.startTrimRecentInterval = function() {
	const self = this;
	const wait = 1000 * Math.ceil( Math.random() * 60 * 2 );
	setTimeout( delayedTrim, wait );
	function delayedTrim() {
		self.recentTrimInterval = setInterval( trimRecent, self.recentTrimMS );
	}
	
	function trimRecent() {
		self.trimRecent();
	}
}

ns.Users.prototype.trimRecent = function() {
	const self = this;
	if ( !self.recentIds.length )
		return;
	
	const now = Date.now();
	self.recentIds.forEach( uId => {
		const touch = self.recent[ uId ];
		if ( null == touch ) {
			self.removeRecent( uId );
			return;
		}
		
		const diff = now - touch;
		if ( diff < self.recentMaxMS )
			return;
		
		self.removeRecent( uId );
	});
}

ns.Users.prototype.addLastRead = async function( userId ) {
	const self = this;
	if ( undefined !== self.lastRead[ userId ]) {
		return;
	}
	
	self.lastRead[ userId ] = null;
	const res = await self.msgDb.setRoomUserMessages( userId );
}

ns.Users.prototype._send = function( targetId, event ) {
	const self = this;
	const user = self.get( targetId );
	if ( !user || !user.send ) {
		return;
	}
	
	user.send( event );
}

ns.Users.prototype._broadcast = function( targetList, event, source, wrapInSource ) {
	const self = this;
	if ( !targetList ) {
		targetList = self.getOnline( true, true );
	}
	
	if ( !source ) {
		targetList.forEach( tId => self._send( tId, event ));
		return;
	}
	
	if ( wrapInSource )
		event = {
			type : source,
			data : event,
		};
	
	targetList.forEach( tId => {
		if ( tId === source )
			return;
		
		self._send( tId, event );
	});
}

ns.Users.prototype.checkIsRegistered = function( cId ) {
	const self = this;
	if ( self.authorized.some( aId => aId === cId ))
		return true;
	if ( self.guests.some( gId => gId === cId ))
		return true;
	if ( isInWorg( cId ))
		return true;
	
	return false;
	
	function isInWorg( cId ) {
		const worgs = self.getWorgsFor( cId );
		return !!worgs.length;
	}
}

ns.Users.prototype.updateViewMembers = function() {
	const self = this;
	if (( null == self.workId ) && ( null == self.superId ))
		return;
	
	/*
	if ( !global.config.server.workroom.subsHaveSuperView )
		return;
	*/
	
	if ( self.updateViewTimeout )
		clearTimeout( self.updateViewTimeout );
	
	self.updateViewTimeout = setTimeout( update, 20 );
	
	function update() {
		const viewers = {};
		self.viewGroups.forEach( wId => {
			const worg = self.worgs[ wId ];
			if ( !worg || !worg.length )
				return;
			
			worg.forEach( uId => {
				viewers[ uId ] = uId;
			});
		});
		
		self.viewers = viewers;
		self.viewerIds = Object.keys( viewers );
		self.emit( 'viewers-updated', self.viewerIds );
	}
}


// CHAT

const cLog = require( './Log' )( 'Room > Chat' );
ns.Chat = function(
	roomId,
	roomName,
	users,
	log,
	service,
) {
	const self = this;
	events.Emitter.call( self );
	
	self.roomId = roomId;
	self.roomName = roomName;
	self.users = users;
	self.log = log;
	self.service = service;
	
	self.init();
}

util.inherits( ns.Chat, events.Emitter );

// Public

ns.Chat.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user || !user.on ) // no .on() means its an offline user
		return;
	
	/*
	const userChat = new events.RequestNode( 'chat', user );
	self.chatters[ userId ] = userChat;
	*/
	user.on( 'chat', cat );
	function cat( e ) { self.handleChat( e, userId ); }
}

ns.Chat.prototype.updateRoomName = function( roomName ) {
	const self = this;
	self.roomName = roomName;
}

ns.Chat.prototype.close = function( callback ) {
	const self = this;
	delete self.roomId;
	delete self.roomName;
	delete self.users;
	delete self.log;
	delete self.service;
	
	if ( callback )
		callback();
}

// Private

ns.Chat.prototype.init = function() {
	const self = this;
	self.eventMap = {
		'msg'       : msg,
		'log'       : log,
		'state'     : state,
		'confirm'   : confirm,
		'edit-get'  : ( e, uid ) => { return self.handleEditGet( e, uid ); },
		'edit-save' : ( e, uid ) => { return self.handleEditSave( e, uid ); },
	};
	
	function msg( e, uid ) { self.createMsg( e, uid ); }
	function log( e, uid ) { self.handleLog( e, uid ); }
	function state( e, uid ) { self.handleState( e, uid ); }
	function confirm( e, uid ) { self.handleConfirm( e, uid ); }
}

ns.Chat.prototype.handleChat = function( event, userId ) {
	const self = this;
	if ( event.requestId ) {
		self.handleRequest( event, userId );
		return;
	}
	
	const handler = self.eventMap[ event.type ];
	if ( !handler ) {
		cLog( 'unknown chat event', event );
		return;
	}
	
	return handler( event.data, userId );
}

ns.Chat.prototype.handleRequest = async function( event, userId ) {
	const self = this;
	const reqId = event.requestId;
	const type = event.type;
	const req = event.data;
	let res = null;
	let err = null;
	try {
		if ( 'edit-get' === type )
			res = await self.handleEditGet( req, userId );
		
		if ( 'edit-save' === type )
			res = await self.handleEditSave( req, userId );
		
	} catch( err ) {
		cLog( 'handleRequest - err', err );
	}
	
	self.returnRequest( err, res, reqId, userId );
}

ns.Chat.prototype.handleEditGet = async function( event, userId ) {
	const self = this;
	const msgId = event.msgId;
	const msg = await self.log.getEvent( msgId );
	return msg;
}

ns.Chat.prototype.returnRequest = function( err, res, reqId, userId ) {
	const self = this;
	const response = {
		requestId : reqId,
		response  : res,
		error     : err,
	};
	self.send( response, userId );
}

ns.Chat.prototype.createMsg = function( input, userId ) {
	const self = this;
	if ( !input || !input.message )
		return;
	
	const user = self.users.get( userId );
	const fromId = user.isGuest ? null : userId;
	let message = input.message;
	if ( 'string' !== typeof( input.message ))
		return;
	
	if ( !message || !message.length )
		return;
	
	const mId = uuid.get( 'msg' );
	const msg = {
		type    : 'msg',
		msgId   : mId,
		roomId  : self.roomId,
		fromId  : fromId,
		name    : user.name,
		time    : Date.now(),
		message : message,
	};
	
	const event = {
		type : 'msg',
		data : msg,
	};
	
	self.log.add( event );
	self.sendMsgNotification( msg, userId );
	self.broadcast( event );
	self.users.setRecent( userId );
}

ns.Chat.prototype.sendMsgNotification = async function( msg, fromId ) {
	const self = this;
	const mId = msg.msgId;
	const time = msg.time;
	const message = msg.message;
	const from = self.users.get( fromId );
	const roomName = '#' + self.roomName;
	const notie = from.name + ': ' + message;
	const uIds = self.users.getList( self.workgroupId );
	const extra = {
		roomId : self.roomId,
		msgId  : mId,
	};
	
	const userList = [];
	uIds.forEach( toId => {
		if ( fromId === toId )
			return;
		
		const user = self.users.get( toId );
		if ( !user || !user.fUsername )
			return;
		
		userList.push( user.fUsername );
	});
	
	if ( !userList.length )
		return;
	
	const notieArgs = [
		userList,
		roomName,
		notie,
		self.roomId,
		time,
		extra,
	];
	
	await self.sendNotification( notieArgs );
}

ns.Chat.prototype.sendNotification = async function( notieArgs, retries ) {
	const self = this;
	if ( null != retries )
		cLog( 'sendNotification', [ notieArgs.length, retries ]);
	
	if ( 3 <= retries ) {
		cLog( 'sendNotification - too many retries', {
			msg     : notieArgs,
			retries : retries,
		});
		return false;
	}
	
	const res = await send( notieArgs, retries );
	if ( null != retries )
		cLog( 'sendNotification - res', [ res, retries ]);
	
	return res;
	
	function send( nargs, ries ) {
		return new Promise(( resolve, reject ) => {
			self.service.sendNotification( ...notieArgs )
				.then( resolve )
				.catch( e => {
					setTimeout( retry, 1000 * 10 );
				});
			
			async function retry() {
				if ( null == ries )
					ries = 1;
				else
					ries++;
				
				cLog( 'retry', [
					nargs,
					ries,
				]);
				
				const res = await self.sendNotification( nargs, ries );
				resolve( res );
			}
		});
	}
}

ns.Chat.prototype.handleLog = async function( event, userId ) {
	const self = this;
	const res = await self.log.get( event );
	const log = {
		type : 'log',
		data : res,
	};
	
	self.send( log, userId );
}

ns.Chat.prototype.handleEditSave = async function( event, userId ) {
	const self = this;
	const mId = event.msgId;
	const msg = event.message;
	const reason = event.reason;
	let dbMsg = await self.log.getEvent( mId );
	if ( !dbMsg )
		return error( 'ERR_EVENT_NOT_FOUND' );
	
	dbMsg = dbMsg.data;
	const isAuthor = dbMsg.fromId === userId;
	const isGracePeriod = checkIsGrace( dbMsg.time );
	const isAdmin = checkIsAdmin( userId );
	
	let result = null;
	if ( isAuthor && isGracePeriod )
		result = await updateMessage( dbMsg.msgId, msg );
	else {
		if ( !isAuthor && !isAdmin )
			return error( 'ERR_EDIT_NOT_ALLOWED' );
		
		if ( !reason || !reason.length || !( 'string' === typeof( reason )) )
			return error( 'ERR_EDIT_NO_REASON' );
		
		result = await editMessage(
			dbMsg.msgId,
			userId,
			reason,
			msg,
		);
	}
	
	if ( 'error' !== result.type ) {
		await self.broadcastEdit( result.type, mId, userId );
	}
	
	return result;
	
	//
	async function updateMessage( mId, message ) {
		let event = await self.log.updateEvent( mId, message );
		if ( !event )
			return error( 'ERR_UPDATE_FAILED' );
		
		return {
			type : 'update',
			data : event,
		};
	}
	
	async function editMessage( mId, editBy, reason, message ) {
		let event = await self.log.editEvent(
			mId,
			editBy,
			reason,
			message
		);
		if ( !event )
			return error( 'ERR_EDIT_FAILED' );
		
		return {
			type : 'edit',
			data : event,
		};
	}
	
	function error( err ) {
		const errEv = {
			type : 'error',
			data : err,
		};
		return errEv;
	}
	
	function checkIsGrace( msgTime ) {
		const now = Date.now();
		const grace = 1000 * 60 * 5;
		return !!( now < ( msgTime + grace));
	}
	
	function checkIsAdmin( uId ) {
		let user = self.users.get( uId );
		if ( !user )
			return false;
		
		return !!user.isAdmin;
	}
}

ns.Chat.prototype.broadcastEdit = async function( type, eventId, editerId ) {
	const self = this;
	const editedEvent = await self.log.getEvent( eventId );
	const update = {
		type : type,
		data : editedEvent,
	};
	self.broadcast( update );
}

ns.Chat.prototype.handleState = function( state, userId ) {
	const self = this;
	const event = {
		type : 'state',
		data : {
			state  : state,
			fromId : userId,
		},
	};
	self.broadcast( event, userId );
}

ns.Chat.prototype.handleConfirm = function( event, userId ) {
	const self = this;
	if ( 'message' === event.type ) {
		self.log.confirm( event.eventId, userId );
		return;
	}
	
	cLog( 'handleConfirm - unhandled confirm event', event );
	
}

ns.Chat.prototype.relay = function( event, targetId, sourceId ) {
	const self = this;
	cLog( 'relay NYI', {
		e : event,
		t : targetId,
		s : sourceId,
	});
}

ns.Chat.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	self.users.broadcastChat( null, event, sourceId, wrapSource );
}

ns.Chat.prototype.send = function( event, userId ) {
	const self = this;
	self.users.sendChat( userId, event );
}

// LIVE - collection of users in a live session

var lLog = require( './Log' )( 'Room > Live' );
ns.Live = function(
	users,
	log,
	workgroups,
	settings,
) {
	const self = this;
	self.users = users;
	self.worgs = workgroups;
	self.settings = settings;
	self.log = log;
	self.peers = {};
	self.peerIds = [];
	
	self.mode = null;
	self.modePri = [ 'presentation', 'follow-speaker' ];
	self.modesSet = {};
	self.followSpeakerLimit = 3;
	self.currentSpeaker = null;
	self.lastSpeaker = null;
	
	self.quality = {
		level : 'normal',
		scale : 1,
	};
	self.lastScaleUpdate = null;
	
	self.pingers = {};
	self.peerTimeouts = {};
	self.pingStep = 1000 * 5;
	self.pingTimeout = 1000 * 2;
	self.peerTimeout = 1000 * 31;
	self.peerAddTimeouts = {};
	
	//Emitter.call( self );
	
	self.init();
}

//util.inherits( ns.Live, Emitter );

// Public

ns.Live.prototype.add = async function( userId, liveId ) { //adds user to existing room
	const self = this;
	const user = self.users.get( userId );
	if ( !user ) {
		lLog( 'handleJoinLive - no user?', {
			userId   : userId,
			liveId   : liveId,
			users    : self.users.getList(),
		});
		return;
	}
	
	if ( !liveId ) {
		lLog( 'add - no client reference', user );
		return;
	}
	
	const peerId = user.clientId;
	if ( self.peers[ peerId ]) {
		await self.reAdd( peerId, liveId );
		return;
	}
	
	user.liveId = liveId;
	self.peers[ peerId ] = user;
	self.peerIds.push( peerId );
	user.on( 'live', handleLive );
	self.updateSession();
	
	if ( self.isRecording ) {
		self.setupStreamProxy();
	}
	
	if ( self.isStream ) {
		self.setupStreamProxy();
		if ( !self.sourceId && self.worgs ) {
			let isStreamer = self.worgs.isStreamer( userId );
			if ( isStreamer ) {
				self.sourceId = userId;
				self.proxy.setSource( userId );
				self.broadcast({
					type : 'source',
					data : self.sourceId,
				});
			}
		}
	}
	
	if ( self.proxy ) {
		self.proxy.addUser( userId );
	}
	
	self.updateSpeakers();
	self.updateQualityScale();
	self.updateModeFollowSpeaker();
	
	// tell everyone
	self.sendJoin( peerId );
	// tell peer
	self.sendOpen( peerId, liveId );
	
	// tell user who else is in live
	//self.sendPeerList( peerId );
	
	self.startPing( peerId );
	
	function handleLive( e ) {
		self.handlePeerEvent( e, peerId );
	}
}

ns.Live.prototype.restore = async function( userId, conf ) {
	const self = this;
	const liveId = conf.clientId;
	lLog( 'restore', {
		uId    : userId,
		conf   : conf,
		liveId : liveId,
		isPeer : !!self.peers[ userId ],
	}, 3 );
	if ( self.peers[ userId ])
		self.sendOpen( userId, liveId );
	else
		await self.add( userId, liveId );
	
	self.sendPeerList( userId );
}

ns.Live.prototype.remove = function( peerId, isReAdd ) { // userId
	const self = this;
	//peerId is the same as userId
	if ( null == self.peers[ peerId ])
		return;
	
	if ( self.mode && self.mode.data.owner === peerId )
		self.clearPresenter();
	
	if ( peerId === self.sourceId ) {
		self.sourceId = null;
		if ( self.proxy )
			self.proxy.setSource( null );
		
		self.broadcast({
			type : 'source',
			data : null,
		});
	}
	
	if ( self.proxy ) {
		self.proxy.removeUser( peerId );
	}
	
	const peer = self.getPeer( peerId );
	if ( !peer )
		return;
	
	self.stopPing( peerId );
	// remove & release
	delete self.peers[ peerId ];
	self.peerIds = Object.keys( self.peers );
	peer.release( 'live' );
	if ( isReAdd ) {
		self.sendClose( peerId, peer.liveId );
		return;
	}
	
	peer.liveId = null;
	self.sendLeave( peerId );
	self.sendClose( peerId );
	self.updateQualityScale();
	self.updateSpeakers();
	self.updateModeFollowSpeaker();
	self.updateSession();
}

ns.Live.prototype.getPeers = function() {
	const self = this;
	return self.peerIds;
}

ns.Live.prototype.close = function( callback ) {
	const self = this;
	self.peerIds.forEach( remove );
	function remove( pid ) {
		self.remove( pid );
	}
	
	self.clearAddTimeouts();
	
	if ( self.speakerTimeout ) {
		clearTimeout( self.speakerTimeout );
		delete self.speakerTimeout;
	}
	
	if ( self.proxy )
		self.closeProxy();
	
	if ( self.settings && self.onStreamEventId )
		self.settings.off( self.onStreamEventId );
	
	if ( self.settings && self.onRecordEventId )
		self.settings.off( self.onRecordEventId );
	
	delete self.isStream;
	delete self.users;
	delete self.log;
	delete self.worgs;
	delete self.settings;
	delete self.peers;
	delete self.peerIds;
	delete self.eventMap;
	
	if ( callback )
		callback();
}

// Private

ns.Live.prototype.init = function() {
	const self = this;
	self.isRecording = self.settings.get( 'isRecording' );
	self.isStream = self.settings.get( 'isStream' );
	self.onStreamEventId = self.settings.on( 'isStream', e => self.isStreamChanged );
	self.onRecordEventId = self.settings.on( 'isRecording', e => self.isRecordingChanged );
	
	self.eventMap = {
		'pong'           : pong,
		'proxy'          : proxy,
		'broadcast'      : broadcast,
		'speaking'       : speaking,
		'quality'        : quality,
		'mode'           : mode,
		'leave'          : leave,
	};
	
	function pong(      e, pid ) { self.handlePong(      e, pid ); }
	function proxy(     e, pid ) { self.handleProxy(     e, pid ); }
	function broadcast( e, pid ) { self.handleBroadcast( e, pid ); }
	function quality(   e, pid ) { self.handleQuality(   e, pid ); }
	function mode(      e, pid ) { self.handleMode(      e, pid ); }
	function speaking(  e, pid ) { self.handleSpeaking(  e, pid ); }
	function leave(     e, pid ) { self.handleLeave(     e, pid ); }
	
}

ns.Live.prototype.isStreamChanged = function( isStream ) {
	const self = this;
	self.isStream = isStream;
	if ( !isStream ) {
		self.closeProxy();
		self.sourceId = null;
	}
	
	self.broadcast({
		type : 'source',
		data : self.sourceId,
	});
}

ns.Live.prototype.isRecordingChanged = function( isRecording ) {
	const self = this;
	self.isRecording = isRecording;
	if ( self.proxy )
		self.proxy.setRecording( self.isRecording );
	
}

ns.Live.prototype.updateSession = function() {
	const self = this;
	const pNum = self.peerIds.length;
	if ( 0 === pNum )
		self.sessionId = null;
	else {
		if ( null == self.sessionId )
			self.sessionId = uuid.get( 'ls' );
	}
}

ns.Live.prototype.reAdd = async function( pid, liveId ) {
	const self = this;
	const curr = self.peerAddTimeouts[ pid ];
	if ( null != curr ){
		// already being re added
		// abort it and do this client instead
		clearTimeout( curr );
		delete self.peerAddTimeouts[ pid ];
	}
	
	const peer = self.peers[ pid ];
	self.remove( pid, true );
	try {
		await wait();
	} catch( ex ) {
		return false;
	}
	
	self.add( pid, liveId );
	return true;
	
	function wait() {
		return new Promise(( resolve, reject ) => {
			self.peerAddTimeouts[ pid ] = setTimeout( teeOut, 100 );
			function teeOut() {
				let timeout = self.peerAddTimeouts[ pid ];
				if ( null == timeout )
					reject( 'timeout canceled' );
				
				delete self.peerAddTimeouts[ pid ];
				resolve( true );
			}
		});
	}
}

ns.Live.prototype.clearAddTimeouts = function() {
	const self = this;
	const addTimeoutIds = Object.keys( self.peerAddTimeouts );
	if ( !addTimeoutIds.length )
		return;
	
	addTimeoutIds.forEach( clear );
	function clear( id ) {
		timeout = self.peerAddTimeouts[ id ];
		try {
			clearTimeout( timeout );
		} catch( e ) {
			// noone cares
		}
		
		delete self.peerAddTimeouts[ id ];
	}
}

ns.Live.prototype.startPing = function( pid ) {
	const self = this;
	if ( self.pingers[ pid ] )
		self.stopPing( pid );
	
	self.pingers[ pid ] = setInterval( ping, self.pingStep );
	function ping() {
		self.sendPing( pid );
	}
}

ns.Live.prototype.sendPing = function( pid ) {
	const self = this;
	var timeouts = self.peerTimeouts[ pid ];
	if ( !timeouts ) {
		self.peerTimeouts[ pid ] = {};
		timeouts = self.peerTimeouts[ pid ];
	}
	
	const timestamp = Date.now()
		.toString();
		
	const ping = {
		type : 'ping',
		data : timestamp,
	};
	self.send( ping, pid );
	timeouts[ timestamp ] = setTimeout( pingTimedOut, self.pingTimeout );
	function pingTimedOut() {
		delete timeouts[ timestamp ];
		self.startPeerTimeout( pid );
	}
}

ns.Live.prototype.startPeerTimeout = function( pid ) {
	const self = this;
	const timeouts = self.peerTimeouts[ pid ];
	if ( timeouts[ pid ] )
		return;
	
	timeouts[ pid ] = setTimeout( peerTimedOut, self.peerTimeout );
	function peerTimedOut() {
		delete timeouts[ pid ];
		self.remove( pid );
	}
}

ns.Live.prototype.stopPeerTimeout = function( pid ) {
	const self = this;
	const timeouts = self.peerTimeouts[ pid ];
	if ( !timeouts )
		return;
	
	const peerTimeout = timeouts[ pid ];
	if ( null == peerTimeout )
		return;
	
	clearTimeout( peerTimeout );
	delete timeouts[ pid ];
}

ns.Live.prototype.stopPing = function( pid ) {
	const self = this;
	const pinger = self.pingers[ pid ];
	if ( !pinger )
		return;
	
	clearInterval( pinger );
	delete self.pingers[ pid ];
	
	const timeouts = self.peerTimeouts[ pid ];
	if ( null == timeouts )
		return;
	
	const outkeys = Object.keys( timeouts );
	outkeys
		.forEach( clear );
		
	delete self.peerTimeouts[ pid ];
		
	function clear( key ) {
		const id = timeouts[ key ];
		try {
			clearTimeout( id );
		} catch ( e ) {
			// noone cares
		}
	}
}

ns.Live.prototype.handlePeerEvent = function( event, peerId ) {
	const self = this;
	if ( !event ) {
		lLog( 'hndlePeerEvent - not an event??', event );
		return;
	}
	
	// check if its a direct message to another peer ( rtc signaling )
	if ( self.peers[ event.type ] ) {
		const target = event.type;
		const source = peerId;
		self.sendToTarget( event.data, source, target );
		return;
	}
	
	// no? check static event handlers
	var handler = self.eventMap[ event.type ];
	if ( handler ) {
		handler( event.data, peerId );
		return;
	}
	
	// really?
	lLog( 'handlePeerEvent - no handler for', event );
}

// handlers

ns.Live.prototype.handleProxy = function( event, peerId ) {
	const self = this;
	if ( !self.proxy ) {
		lLog( 'handleProxy - no proxy', event );
		return;
	}
	
	self.proxy.handleSignal( event, peerId );
}

ns.Live.prototype.handlePong = function( timestamp, peerId ) {
	const self = this;
	const timeouts = self.peerTimeouts[ peerId ];
	if ( !timeouts )
		return;
	
	const pingout = timeouts[ timestamp ];
	if ( null == pingout )
		return;
	
	clearTimeout( pingout );
	delete timeouts[ timestamp ];
	
	// lets do something with this?
	const ping = Date.now() - parseInt( timestamp, 10 );
	
	const peerout = timeouts[ peerId ];
	if ( null == peerout )
		return;
	
	clearTimeout( peerout );
	delete timeouts[ peerId ];
}

ns.Live.prototype.handleBroadcast = function( event, peerId ) {
	const self = this;
	self.broadcast( event, peerId, true );
}

ns.Live.prototype.setupStreamProxy = function() {
	const self = this;
	if ( self.proxy )
		return;
	
	const jConf = global.config.server.janus;
	let type = 'star';
	if ( self.isStream )
		type = 'stream';
	
	lLog( 'setupStreamProxy', {
		isRec : self.isRecording,
		isStr : self.isStream,
		type  : type,
		jConf : jConf,
	});
	const pConf = {
		roomId      : self.users.roomId,
		isRecording : self.isRecording,
	};
	self.proxy = new Janus( type, jConf, pConf );
	self.proxy.on( 'signal', toSignal );
	self.proxy.on( 'closed', e => self.proxyClosed( e ));
	
	function toSignal( e, uid ) {
		/*
		lLog( 'toSignal', {
			e   : e,
			uid : uid,
		});
		*/
		const proxy = {
			type : 'proxy',
			data : e,
		};
		self.send( proxy, uid );
	}
	
	function closed( e ) { self.proxyClosed( e ); }
}

ns.Live.prototype.closeProxy = async function() {
	const self = this;
	if ( !self.proxy )
		return;
	
	const proxy = self.proxy;
	delete self.proxy;
	proxy.close();
}

ns.Live.prototype.proxyClosed = function( reason ) {
	const self = this;
	lLog( 'proxyClosed', reason );
	if ( self.proxy ) {
		self.proxy.close();
		delete self.proxy;
	}
	
	// TODO :  re setup? still in stream mode? still/again has users?
}

ns.Live.prototype.handleQuality = function( level, peerId ) {
	const self = this;
	self.quality.level = level;
	self.lastScaleUpdate = null;
	self.updateQualityScale();
}

ns.Live.prototype.handleMode = function( mode, peerId ) {
	const self = this;
	if ( 'presentation' === mode.type )
		self.toggleModePresentation( mode, peerId );
	
	if ( 'show-speaker' === mode.type )
		self.toggleModeFollowSpeaker( null, mode, peerId );
	
	self.updateMode( peerId );
}

ns.Live.prototype.clearPresenter = function() {
	const self = this;
	const type = self.mode.type;
	if ( 'presentation' === type )
		self.toggleModePresentation();
	
	self.updateMode();
}

ns.Live.prototype.toggleModeFollowSpeaker = function( setActive, conf, peerId ) {
	const self = this;
	const modeType = 'follow-speaker';
	const mode = self.modesSet[ modeType ];
	if ( setActive && !mode )
		set( conf, peerId );
	
	if ( !setActive && mode )
		unset();
	
	function unset() {
		delete self.modesSet[ modeType ];
	}
	
	function set( conf, peerId ) {
		const mode = {
			type : modeType,
			data : {
				owner : peerId || null,
			},
		};
		self.modesSet[ modeType ] = mode;
	}
}

ns.Live.prototype.toggleModePresentation = function( conf, peerId ) {
	const self = this;
	const modeType = 'presentation';
	if ( !peerId ) {
		unset();
		return;
	}
	
	const allow = allowChange( peerId );
	if ( !allow )
		return;
	
	const mode = self.modesSet[ modeType ];
	if ( !mode )
		set( peerId );
	else
		unset();
	
	function unset() {
		delete self.modesSet[ modeType ];
	}
	
	function set( presenterId ) {
		const mode = {
			type : 'presentation',
			data : {
				owner : presenterId,
			},
		};
		self.modesSet[ modeType ] = mode;
	}
	
	function allowChange( peerId ) {
		const pMode = self.modesSet[ modeType ];
		if ( !pMode )
			return true;
		
		if ( peerId !== pMode.data.owner )
			return false;
		
		return true;
	}
}

ns.Live.prototype.updateMode = function() {
	const self = this;
	let update = false;
	const hasMode = self.modePri.some( type => {
		const mode = self.modesSet[ type ];
		if ( null == mode )
			return false;
		
		if ( null == self.mode ) {
			self.mode = mode;
			update = true;
			return true;
		}
		
		if ( mode.type === self.mode.type )
			return true;
		
		self.mode = mode;
		update = true;
		return true;
	});
	
	if ( !hasMode && self.mode ) {
		self.mode = null;
		update = true;
	}
	
	if ( !update )
		return;
	
	self.sendMode();
}

ns.Live.prototype.sendMode = function( peerId ) {
	const self = this;
	const mode = {
		type : 'mode',
		data : self.mode || null,
	};
	if ( peerId )
		self.send( mode, peerId );
	else
		self.broadcast( mode );
}

ns.Live.prototype.handleSpeaking = function( event, peerId ) {
	const self = this;
	if ( false === event.isSpeaking )
		handleStoppedSpeaking( event, peerId );
	else
		handleIsSpeaking( event, peerId );
	
	function handleIsSpeaking( event, peerId ) {
		if ( null != self.speakerTimeout )
			return;
		
		self.speakerTimeout = setTimeout( clear, 1000 * 2 );
		if ( null != self.currentSpeaker )
			self.lastSpeaker = self.currentSpeaker;
		
		self.currentSpeaker = peerId;
		self.sendSpeaking();
	}
	
	function handleStoppedSpeaking( event, peerId ) {
		if ( peerId !== self.currentSpeaker )
			return;
		
		if ( self.speakerTimeout ) {
			clearTimeout( self.speakerTimeout );
			self.speakerTimeout = null;
		}
		
		self.lastSpeaker = self.currentSpeaker;
		self.currentSpeaker = null;
		
		self.sendSpeaking();
	}
	
	function clear() {
		self.speakerTimeout = null;
	}
}

ns.Live.prototype.sendSpeaking = function() {
	const self = this;
	const state = {
		time    : Date.now(),
		current : self.currentSpeaker,
		last    : self.lastSpeaker,
	};
	const speaking = {
		type : 'speaking',
		data : state,
	};
	self.broadcast( speaking );
}

ns.Live.prototype.handleLeave = function( event, peerId ) {
	const self = this;
	self.remove( peerId );
}

// things

ns.Live.prototype.updateSpeakers = function() {
	const self = this;
	let update = false;
	let cIdx = null;
	let lIdx = null;
	if ( self.currentSpeaker )
		cIdx = self.peerIds.indexOf( self.currentSpeaker );
	if ( self.lastSpeaker )
		lIdx = self.peerIds.indexOf( self.lastSpeaker );
	
	if ( -1 == cIdx ) {
		self.currentSpeaker = null;
		update = true;
	}
	
	if ( -1 == lIdx ) {
		self.lastSpeaker = self.peerIds[ 0 ];
		update = true;
	}
	
	if ( null == self.lastSpeaker ) {
		self.lastSpeaker = self.peerIds[ 0 ];
		update = true;
	}
	
	if ( !update )
		return;
	
	self.sendSpeaking();
}

ns.Live.prototype.updateModeFollowSpeaker = function() {
	const self = this;
	const peerNum = self.peerIds.length;
	const modeActive = !!self.modesSet[ 'follow-speaker' ];
	if ( modeActive && ( peerNum < self.followSpeakerLimit ))
		self.toggleModeFollowSpeaker( false );
	
	if ( !modeActive && ( peerNum >= self.followSpeakerLimit ))
		self.toggleModeFollowSpeaker( true );
	
	self.updateMode();
}

ns.Live.prototype.updateQualityScale = function() {
	const self = this;
	const peers = self.peerIds.length;
	if ( null == self.lastScaleUpdate ) {
		self.lastScaleUpdate = 0;
		self.quality.scale = recalc( peers );
		self.updateQuality();
		return;
	}
	
	const change = peers - self.lastScaleUpdate;
	let direction = ( 0 < change ) ? 1 : -1;
	const delta = Math.abs ( change );
	
	if ( !self.lastScaleDirection ) {
		self.lastScaleDirection = 1;
	}
	
	if ( self.lastScaleDirection !== direction ) {
		self.lastScaleUpdate = peers - direction;
	}
	
	self.lastScaleDirection = direction;
	if ( 2 < delta ) {
		self.lastScaleUpdate = peers;
		self.quality.scale = recalc( peers );
	}
	
	self.updateQuality();
	
	function recalc( peers ) {
		var scale = 1;
		if ( 2 < peers )
			scale = 0.75;
		
		if ( 5 < peers )
			scale = 0.5;
		
		if ( 7 < peers )
			scale = 0.25;
		
		return scale;
	}
}

ns.Live.prototype.updateQuality = function() {
	const self = this;
	const quality = {
		type : 'quality',
		data : self.quality,
	};
	
	self.broadcast( quality );
}

ns.Live.prototype.sendToTarget = function( event, sourceId, targetId ) {
	const self = this;
	const msg = {
		type : sourceId,
		data : event,
	};
	self.send( msg, targetId );
}

ns.Live.prototype.sendPeerList = function( peerId ) {
	const self = this;
	const peers = {
		type : 'peers',
		data : {
			peerIds : self.peerIds,
		},
	};
	
	if ( peerId )
		self.send( peers, peerId );
	else
		broadcast( peers );
}

ns.Live.prototype.sendJoin = function( joinedId ) {
	const self = this;
	const joined = {
		type : 'join',
		data : {
			peerId : joinedId,
			meta   : null,
		},
	};
	self.broadcastOnline( joined );
}

ns.Live.prototype.sendOpen  = function( pid, clientId ) {
	const self = this;
	lLog( 'sendOpen', [ pid, clientId ]);
	let topology = 'peer';
	if ( self.proxy )
		topology = 'star';
	
	const live = {
		sessionId : self.sessionId,
		liveConf  : {
			ICE            : global.config.shared.rtc.iceServers,
			userId         : pid,
			sourceId       : self.sourceId,
			peerList       : self.peerIds,
			quality        : self.quality,
			mode           : self.mode,
			topology       : topology,
			isRecording    : self.isRecording,
			logTail        : self.log.getLast( 20 ),
			speaking       : {
				current : self.currentSpeaker,
				last    : self.lastSpeaker,
			},
		},
	};
	
	const open = {
		type : 'open',
		data : {
			clientId : clientId,
			live     : live,
		},
	};
	self.send( open, pid );
}


ns.Live.prototype.sendLeave = function( leftId ) {
	const self = this;
	const leave = {
		type : 'leave',
		data : {
			peerId : leftId,
		},
	};
	self.broadcastOnline( leave );
}

ns.Live.prototype.sendClose = function( peerId, clientId ) {
	const self = this;
	const close = {
		type : 'close',
		data : {
			clientId  : clientId || null,
			sessionId : self.sessionId,
		},
	};
	self.send( close, peerId );
}

ns.Live.prototype.getPeer = function( peerId ) {
	const self = this;
	var peer = self.peers[ peerId ] || self.users.get( peerId ) || null;
	if ( !peer ) {
		lLog( 'no peer found for', {
			pid   : peerId,
			peers : self.peers,
		});
		return null;
	}
	
	return peer;
}

ns.Live.prototype.broadcast = function( data, sourceId, wrapSource ) {
	const self = this;
	self.users.broadcastLive( self.peerIds, data, sourceId, wrapSource );
}

ns.Live.prototype.broadcastOnline = function( data, sourceId, wrapSource ) {
	const self = this;
	let online = self.users.getOnline();
	self.users.broadcastLive( online, data, sourceId, wrapSource );
}

ns.Live.prototype.send = function( event, targetId, callback ) {
	const self = this;
	self.users.sendLive( targetId, event );
}

//
// INVITE

const iLog = require( './Log' )( 'Room > Invite' );
ns.Invite = function(
		dbPool,
		roomId,
		users,
		isPersistent
) {
	const self = this;
	events.Emitter.call( self );
	
	self.roomId = roomId;
	self.users = users;
	self.isPersistent = isPersistent;
	
	self.publicToken = null;
	self.tokens = {};
	self.invites = {};
	
	self.eventMap = null;
	
	self.init( dbPool, roomId );
}

ns.Invite.prototype.initialize = async function() {
	const self = this;
	await self.loadTokens();
}

util.inherits( ns.Invite, events.Emitter );

// Public

ns.Invite.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user || !user.on )
		return;
	
	user.on( 'invite', ( e ) => self.handle( e, userId ));
}

ns.Invite.prototype.release = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user || !user.release )
		return;
	
	user.release( 'invite' );
}

ns.Invite.prototype.authenticate = async function( token, targetId ) {
	const self = this;
	if ( self.publicToken && ( token === self.publicToken.token ))
		return true;
	
	const meta = self.tokens[ token ];
	if ( null == meta )
		return false;
	
	if ( meta.targetId ) {
		if ( targetId === meta.targetId ) {
			await self.invalidateInvite( token );
			return true;
		}
		else
			return false;
	}
	
	await self.invalidateToken( token );
	return true;
}

ns.Invite.prototype.getInvites = function() {
	const self = this;
	return self.invites;
}

ns.Invite.prototype.setPersistent = function( isPersistent ) {
	const self = this;
	if ( !!self.isPersistent === isPersistent )
		return;
	
	self.isPersistent = isPersistent;
	if ( !self.isPersistent )
		return;
	
	self.persistCurrentTokens()
		.then(() => {})
		.catch(() => {});
}

ns.Invite.prototype.close = function( callback ) {
	const self = this;
	if ( self.db )
		self.db.close();
	
	delete self.db;
	delete self.users;
	delete self.isPersistent;
	delete self.publicToken;
	delete self.tokens;
	
	if ( callback )
		callback();
}

// Private

ns.Invite.prototype.init = function( pool, roomId ) {
	const self = this;
	self.db = new dFace.InviteDB( pool, roomId );
	
	self.eventMap = {
		'state'    : ( e, uid ) => self.handleState( e, uid ),
		'public'   : ( e, uid ) => self.handlePublic( e, uid ),
		'private'  : ( e, uid ) => self.handlePrivate( e, uid ),
		'revoke'   : ( e, uid ) => self.handleRevoke( e, uid ),
		'room-add' : ( e, uid ) => self.handleRoomAdd( e, uid ),
	};
}

ns.Invite.prototype.loadTokens = async function() {
	const self = this;
	let dbTokens = null;
	// currently only loads public tokens
	dbTokens = await self.db.getForRoom();
	dbTokens.map( inv => {
		const invite = {
			type      : inv.type,
			token     : inv.token,
			roomId    : inv.roomId,
			created   : inv.created,
			createdBy : inv.createdBy,
			targetId  : inv.targetId,
			singleUse : !!inv.singleUse,
		};
		if ( 'public' === invite.type )
			setPublic( invite );
		else
			self.tokens[ invite.token ] = invite;
		
		if ( null != invite.targetId ) {
			self.invites[ invite.targetId ] = invite;
		}
		
	});
	
	function setPublic( inv ) {
		self.publicToken = inv;
	}
}

ns.Invite.prototype.checkDbToken = function( token ) {
	const self = this;
	return new Promise( tokenIsValid );
	function tokenIsValid( resolve, reject ) {
		self.db.checkForRoom( token )
			.then( isValid )
			.catch( fail );
		
		function isValid( res ) {
			if ( !res )
				resolve( false );
			else
				resolve( !!res.isValid );
		}
		
		function fail( err ) {
			iLog( 'checkDbToken.fail', err );
			reject( false );
		}
	}
}

ns.Invite.prototype.handle = function( event, userId ) {
	const self = this;
	var handler = self.eventMap[ event.type ];
	if ( !handler ) {
		iLog( 'no handler for ', { e : event, uid : userId });
		return;
	}
	
	handler( event.data, userId );
}

ns.Invite.prototype.handleState = function( event, userId ) {
	const self = this;
	const tokenList = Object.keys( self.tokens );
	const privTokens = tokenList.filter( token => {
		const inv = self.tokens[ token ];
		return ( inv.type === 'private' );
	});
	const pubToken = self.publicToken || {};
	const state = {
		type : 'state',
		data : {
			publicToken   : pubToken.token,
			privateTokens : tokenList,
			host          : self.getInviteHost(),
		},
	};
	self.send( state, userId );
}

ns.Invite.prototype.getPublicToken = async function( userId ) {
	const self = this;
	if ( !self.publicToken )
		return await setPublicToken( userId );
	else
		return returnToken();
	
	async function setPublicToken( userId ) {
		const token = await self.createToken( 'public', null, userId, false );
		if ( !token )
			return;
		
		self.publicToken = {
			type      : 'public',
			token     : token,
			createdBy : userId,
		};
		const pub = returnToken();
		self.broadcast( pub );
		return pub;
	}
	
	function returnToken() {
		const pub = {
			type : 'public',
			data : {
				token : self.publicToken.token,
				host  : self.getInviteHost(),
			},
		};
		
		return pub;
	}
}

ns.Invite.prototype.handlePublic = async function( event, userId ) {
	const self = this;
	const pub = await self.getPublicToken( userId );
	if ( event && event.reqId )
		pub.data.reqId = event.reqId;
	
	self.send( pub, userId );
}

ns.Invite.prototype.handlePrivate = async function( event, userId ) {
	const self = this;
	event = event || {};
	const token = await self.createToken( 'private', null, userId );
	if ( token && !self.isPersistent )
		self.tokens[ token ] = {
			type      : 'private',
			token     : token,
			createdBy : userId,
		};
	
	const priv = {
		type : 'private',
		data : {
			token : token,
			host  : self.getInviteHost(),
			reqId : event.reqId || null,
		},
	};
	self.broadcast( priv );
}

ns.Invite.prototype.createToken = async function( type, targetId, createdBy, singleUse ) {
	const self = this;
	if ( null == singleUse )
		singleUse = true;
	
	if ( null != targetId ) {
		let exists = await self.db.checkExists( targetId );
		if ( exists ) {
			iLog( 'createToken - this target already has an invite', targetId );
			return;
		}
	}
	
	let token = uuid.get( type );
	if ( !self.isPersistent )
		return token;
	
	try {
		await self.db.set(
			type,
			token,
			targetId,
			createdBy,
			singleUse
		);
	} catch( e ) {
		iLog( 'createToken.trySetToken failed', e );
		return null;
	}
	
	return token;
}

ns.Invite.prototype.persistCurrentTokens = async function() {
	const self = this;
	if ( !self.isPersistent )
		return;
	
	let pubSuccess = false;
	if ( self.publicToken ) {
		let pubToken = self.publicToken;
		try {
			pubSuccess = await self.db.set( pubToken.token, false, pubToken.createdBy );
		} catch( err ) {
			iLog( 'failed to persist public token', err );
		}
	}
	
	let privTokens = Object.keys( self.tokens );
	privTokens.forEach( persist );
	async function persist( token ) {
		let meta = self.tokens[ token ];
		
		// skipping room invites for now
		if ( meta.targetId )
			return;
		
		try {
			await self.db.set( meta.token, true, meta.createdBy );
		} catch( err ) {
			iLog( 'failed to persist private token', err );
		}
		
		delete self.tokens[ token ];
	}
}

ns.Invite.prototype.handleRoomAdd = async function( invited, userId ) {
	const self = this;
	const targetId = invited.clientId;
	const token = await self.createToken( 'room', targetId, userId, true );
	if ( null == token )
		return;
	
	const invite = {
		type      : 'room',
		token     : token,
		createdBy : userId,
		targetId  : targetId,
		fromId    : userId,
	};
	self.tokens[ token ] = invite;
	
	self.emit( 'add', invite );
}

ns.Invite.prototype.handleRevoke = async function( token, userId ) {
	const self = this;
	// TODO guest check here
	const ok = await self.invalidateToken( token, userId )
	return ok;
}

ns.Invite.prototype.invalidateInvite = async function( token, userId ) {
	const self = this;
	const invite = self.tokens[ token ];
	delete self.invites[ invite.targetId ];
	const invalid = await self.invalidateToken( token, userId );
	if ( invalid )
		self.emit( 'invalid', invite );
	
	return invalid;
}

ns.Invite.prototype.invalidateToken = async function( token, userId ) {
	const self = this;
	let ok = false;
	if ( 'public' === token || ( self.publicToken && ( self.publicToken.token === token ) ))
		ok = await revokePublic( token, userId );
	else
		ok = await revoke( token, userId );
	
	return ok;
	
	async function revoke( token, userId ) {
		delete self.tokens[ token ];
		
		try {
			await invalidateDbToken( token, userId );
		} catch( e ) {
			iLog( 'invalidateToken - failed to revoke DB token', e );
			return false;
		}
		
		broadcastRevoke( token );
		return true;
	}
	
	async function revokePublic( token, userId ) {
		// 'public' is a valid argument, but not an actual token
		if ( self.publicToken )
			token = self.publicToken.token;
		
		self.publicToken = null;
		try {
			await invalidateDbToken( token, userId );
		} catch ( e ) {
			iLog( 'invalidateToken - failed to revoke DB token', e );
			return false;
		}
		
		broadcastRevoke( 'public' );
		return true;
	}
	
	function invalidateDbToken( token, userId ) {
		return self.db.invalidate( token, userId );
	}
	
	function broadcastRevoke( token ) {
		const revoke = {
			type : 'revoke',
			data : token,
		};
		self.broadcast( revoke );
	}
}

ns.Invite.prototype.getInviteHost = function() {
	const self = this;
	return global.config.shared.wsHost;
}

ns.Invite.prototype.broadcast = function( event, sourceId ) {
	const self = this;
	const online = self.users.getOnline();
	self.users.broadcastInvite( online, event, sourceId );
	
	/*
	self.onlineList
		.forEach( sendTo );
		
	function sendTo( uid ) {
		if ( uid === sourceId )
			return;
		
		self.send( event, uid );
	}*/
}

ns.Invite.prototype.send = function( event, targetId ) {
	const self = this;
	self.users.sendInvite( targetId, event );
	
	/*
	const user = self.users[ targetId ];
	if ( !user )
		return;
	
	if ( !user.send ) {
		iLog( 'send - user has no .send()', user );
		return;
	}
	
	const inv = {
		type : 'invite',
		data : event,
	};
	user.send( inv );
	*/
}

//
// LOG
//

const llLog = require( './Log' )( 'Room > Log' );
ns.Log = function( dbPool, roomId, users, idCache, persistent ) {
	const self = this;
	self.roomId = roomId;
	self.users = users;
	self.idCache = idCache;
	self.persistent = persistent;
	
	self.items = [];
	self.ids = {};
	self.msgDb = null;
	
	self.init( dbPool );
}

ns.Log.prototype.initialize = async function() {
	const self = this;
	let log = null;
	try {
		log = await self.load();
	} catch( e ) {
		llLog( 'Log.initialize - load err', e );
		return false;
	}
	
	if ( !log || !log.data )
		return true;
	
	self.items = log.data.events || [];
	self.ids = log.data.ids;
	
	return true;
}

// Public

ns.Log.prototype.add = async function( msg ) {
	const self = this;
	self.items.push( msg );
	if ( 100 < self.items.length )
		self.items = self.items.slice( -50 );
	
	if ( !self.persistent )
		return;
	
	const msgId = await self.persist( msg );
}

ns.Log.prototype.get = async function( conf ) {
	const self = this;
	if ( null == conf ) {
		let logs = {
			type : 'before',
			data : {
				events : self.items,
				ids    : self.ids,
			},
		};
		return logs;
	} else {
		let logs = null;
		try {
			logs = await self.load( conf );
		} catch( ex ) {
			llLog( 'load error', err.stack || err );
			return null;
		}
		
		return logs;
	}
}

ns.Log.prototype.getEvent = function( eId ) {
	const self = this;
	return new Promise(( resolve, reject ) => {
		self.msgDb.get( eId )
			.then( eBack )
			.catch( error );
			
		function eBack( event ) {
			resolve( event );
		}
		
		function error( err ) {
			llLog( 'getEvent - error', err );
			resolve( null );
		}
	});
}

ns.Log.prototype.getLast = function( length ) {
	const self = this;
	if ( !self.items || !self.items.length )
		return [];
	
	return self.items.slice( -length );
}

ns.Log.prototype.updateEvent = async function(
	eventId,
	message
) {
	const self = this;
	let uptd = null;
	try {
		uptd = await self.msgDb.update( eventId, message );
	} catch( e ) {
		llLog( 'updateEvent - db err', e );
		return null;
	}
	
	if ( !uptd )
		return null;
	
	const event = await self.updateCache( eventId );
	return event;
}

ns.Log.prototype.editEvent = async function(
	eventId,
	editBy,
	reason,
	message
) {
	const self = this;
	let uptd = null;
	try {
		uptd = await self.msgDb.setEdit(
			eventId,
			editBy,
			reason,
			message,
		);
	} catch ( e ) {
		llLog( 'editEvent - db err', e );
		return null;
	}
	
	if ( !uptd )
		return null;
	
	const event = self.updateCache( eventId );
	return event;
}

ns.Log.prototype.setPersistent = function( isPersistent ) {
	const self = this;
	if ( self.persistent )
		return;
	
	self.persistent = isPersistent;
	self.writeLogToDb();
}

ns.Log.prototype.getUnreadForUser = async function( userId ) {
	const self = this;
	const unread = await self.msgDb.getRoomUserMessagesUnread( userId );
	return unread;
}

ns.Log.prototype.confirm = async function( msgId, userId ) {
	const self = this;
	await self.msgDb.updateRoomUserMessages( msgId, [ userId ]);
}

ns.Log.prototype.close = function() {
	const self = this;
	if ( self.msgDb )
		self.msgDb.close();
	
	delete self.msgDb;
	delete self.roomId;
	delete self.users;
	delete self.idCache;
}

// Private

ns.Log.prototype.init = function( pool ) {
	const self = this;
	self.msgDb = new dFace.MessageDB( pool, self.roomId );
}

ns.Log.prototype.load = function( conf ) {
	const self = this;
	if ( !conf ) {
		conf = {};
		return self.loadBefore( conf );
	}
	
	if ( conf.lastTime )
		return self.loadAfter( conf );
	else
		return self.loadBefore( conf );
}

ns.Log.prototype.loadBefore = async function( conf, worg ) {
	const self = this;
	let items = null;
	try {
	 	items = await self.msgDb.getBefore( conf.firstTime, conf.length, worg );
	} catch( err ) {
		llLog( 'loadBefore - err', err );
		return null;
	}
	
	return await self.buildLogEvent( 'before', items );
}

ns.Log.prototype.loadAfter = async function( conf, worg ) {
	const self = this;
	let items = null;
	try {
		items = await self.msgDb.getAfter( conf.lastTime, conf.length, worg );
	} catch( err ) {
		llLog( 'loadAfter - err', err );
		return null;
	}
	
	return await self.buildLogEvent( 'after', items );
}

ns.Log.prototype.buildLogEvent = async function( type, events ) {
	const self = this;
	let unknownIds = null;
	let log = {
		type : type,
		data : {
			events : events,
			//ids    : unknownIds,
		},
	};
	return log;
	
}

ns.Log.prototype.persist = async function( event ) {
	const self = this;
	let item = event.data;
	item.type = event.type;
	let msgId = null;
	if ( 'msg' === item.type )
		msgId = await self.setMsg( item );
	
	if ( 'work-msg' === item.type )
		msgId = await self.setWorkMsg( item );
	
	await self.setLastRead( msgId );
	return msgId;
}

ns.Log.prototype.setMsg = async function( item ) {
	const self = this;
	let msgId = null;
	try {
		msgId = await self.msgDb.set( item );
	} catch( err ) {
		llLog( 'setMsg - err', err.stack || err );
		return null;
	}
	
	return msgId;
}

ns.Log.prototype.setWorkMsg = async function( item ) {
	const self = this;
	let msgId = null;
	try {
		msgId = await self.msgDb.setWork( item );
	} catch( err ) {
		llLog( 'setWorkMsg - err', err.stack || err );
		return null;
	}
	
	return msgId;
}

ns.Log.prototype.setLastRead = async function( msgId ) {
	const self = this;
	const active = self.users.getActive();
	await self.msgDb.updateRoomUserMessages( msgId, active );
}

ns.Log.prototype.writeLogToDb = function() {
	const self = this;
	self.items.forEach( store );
	function store( item ) {
		self.persist( item );
	}
}

ns.Log.prototype.updateCache = async function( msgId ) {
	const self = this;
	const mIdx = self.items.findIndex( item => {
		if ( item.data.msgId === msgId )
			return true;
		
		return false;
	});
	
	const event = await self.getEvent( msgId );
	if ( -1 === mIdx )
		add( msgId, event );
	else 
		update( mIdx, event );
	
	return event;
	
	function add( msgId, event ) {
		const eventTime = event.data.time;
		const currentLast = self.items[ self.items.length -1 ];
		if ( !currentLast ) {
			self.items.push( event );
			return;
		}
		
		const currentLastTime = currentLast.data.time;
		if ( currentLastTime < eventTime ) {
			self.items.push( event );
			return;
		}
		
		let insertIndex = null;
		self.items.some(( item, index ) => {
			const itemTime = item.data.time;
			if ( itemTime < eventTime )
				return false;
			
			insertIndex = index;
			return true;
		});
		
		if ( null == insertIndex ) {
			self.items.push( event );
			return;
		}
		
		self.items.splice( insertIndex, 0, event );
		return true;
	}
	
	function update( mIndex, event ) {
		self.items.splice( mIndex, 1, event );
	}
}

// Workgroup - must be .initialize()'d after instanciation

let wLog = require( './Log' )( 'Room > Workgroup' );
ns.Workgroup = function(
	worgCtrl,
	dbPool,
	roomId,
	users,
	settings
 ) {
	const self = this;
	events.Emitter.call( self );
	
	self.dbPool = dbPool;
	
	self.worgCtrl = worgCtrl;
	self.roomId = roomId;
	self.users = users;
	self.settings = settings;
	
	self.db = null;
	self.fIds = [];
	self.cIds = [];
	self.assigned = {};
	self.atNames = [];
}

util.inherits( ns.Workgroup, events.Emitter );

ns.Workgroup.prototype.initialize = async function() {
	const self = this;
	const dbPool = self.dbPool;
	delete self.dbPool;
	await self.init( dbPool );
}

// 

ns.Workgroup.prototype.setAssigned = async function( worgIds, userId ) {
	const self = this;
	const currFIds = Object.keys( self.assigned );
	const curr = currFIds
		.map( fId => self.worgCtrl.getByFId( fId ))
		.filter( x => !!x );
	
	const dismiss = curr.filter( curr => {
		const currId = curr.clientId;
		return !worgIds.some( wId => wId == currId );
	});
	
	const dWaiters = dismiss.map( w => self.dismiss( w ));
	await Promise.all( dWaiters );
	
	const assWaiters = worgIds.map( wId => {
		const worg = self.worgCtrl.get( wId );
		return self.assign( worg, userId );
	});
	let assFIds = await Promise.all( assWaiters );
	assFIds = assFIds.filter( aFId => !!aFId );
	
	return assFIds;
}

ns.Workgroup.prototype.get = function() {
	const self = this;
	const all = {
		available : self.getAvailable(),
		assigned  : self.getAssigned(),
	};
	return all;
}

ns.Workgroup.prototype.getUserList = function() {
	const self = this;
	if ( !self.cIds || !self.cIds.length )
		return [];
	
	const uIdMap = {};
	self.cIds.forEach( wId => {
		const uList = self.worgCtrl.getUserList( wId );
		if ( !uList || !uList.length )
			return;
		
		uList.forEach( uId => {
			uIdMap[ uId ] = true;
		});
	});
	
	const uIds = Object.keys( uIdMap );
	return uIds || [];
}

ns.Workgroup.prototype.getAtNames = function() {
	const self = this;
	return self.atNames;
}

ns.Workgroup.prototype.getUserWorkgroupList = function( userId ) {
	const self = this;
	const uwgs = self.worgCtrl.getMemberOf( userId );
	return uwgs;
}

ns.Workgroup.prototype.isStreamer = function( userId ) {
	const self = this;
	const isStreamer = self.worgCtrl.checkUserIsStreamerFor( userId, self.cIds );
	return isStreamer;
}

ns.Workgroup.prototype.getAvailable = function() {
	const self = this;
	return self.worgCtrl.get();
}

ns.Workgroup.prototype.getAssigned = function() {
	const self = this;
	const available = self.fIds.map( addInfo );
	return available.filter( wg => !!wg );
	
	function addInfo( fId ) {
		let ass = self.assigned[ fId ];
		let wg = self.worgCtrl.getByFId( fId );
		if ( !wg )
			return null;
		
		ass.clientId = wg.clientId;
		ass.name = wg.name;
		return ass;
	}
}

ns.Workgroup.prototype.getAssignedClientIds = function() {
	const self = this;
	return self.cIds;
}

ns.Workgroup.prototype.checkHasWorkgroup = function( userId ) {
	const self = this;
	const ass = self.getAssignedForUser( userId );
	if ( !ass || !ass.length )
		return false;
	
	return true;
}

ns.Workgroup.prototype.getAssignedForUser = function( userId ) {
	const self = this;
	const uwgs = self.worgCtrl.getMemberOf( userId );
	if ( !uwgs || !uwgs.length )
		return [];
	
	const ass = self.getAssignedClientIds();
	const userAss = ass.filter( userIsMember );
	return userAss;
	
	function userIsMember( aId ) {
		return !!uwgs.some( cId => aId === cId );
	}
}

// used by settings
ns.Workgroup.prototype.updateAssigned = async function( item, userId ) {
	const self = this;
	if ( !item || !item.clientId ) {
		sendErr( 'ERR_NO_CLIENTID', userId );
		return;
	}
	
	const cId = item.clientId;
	const worg = self.worgCtrl.get( cId );
	if ( !worg ) {
		sendErr( 'ERR_NO_GROUP', userId );
		return;
	}
	
	let res = null;
	if ( true === item.value )
		res = await self.assign( worg, userId );
	else
		res = await self.dismiss( worg );
	
	if ( !res )
		sendErr( 'ERR_DISMISS_FAILED', userId );
	else
		sendOk( item, userId );
	
	function sendOk( item, userId ) {
		self.settings.sendSaved( 'workgroups', item, true, userId );
		self.updateSettings();
	}
	
	function sendErr( err, userId ) {
		self.settings.sendError( 'workgroups', err, userId );
	}
}

	// Assign workgroup to room
ns.Workgroup.prototype.assign = async function( worg, userId ) {
	const self = this;
	const fId = worg.fId;
	if ( self.assigned[ fId ])
		return fId;
	
	const dbWorg = await self.db.assignWorkgroup( fId, userId );
	if ( !dbWorg )
		return null;
	
	self.addAssigned( dbWorg );
	self.emit( 'assigned', {
		fId : fId,
		cId : worg.clientId,
	});
	return fId;
}

	// Remove workgroup from room
ns.Workgroup.prototype.dismiss = async function( worg ) {
	const self = this;
	const fId = worg.fId;
	if ( !self.assigned[ fId ])
		return true;
	
	const res = await self.db.dismissWorkgroup( fId )
	if ( !res )
		return null;
	
	self.removeDismissed( fId );
	self.users.removeWorg( worg.clientId );
	self.removeUsers();
	self.emit( 'dismissed', {
		fId : fId,
		cId : worg.clientId,
	});
	
	return true;
}

ns.Workgroup.prototype.send = function( event, userId, callback ) {
	const self = this;
	self.users.sendWorg( userId, event );
}

ns.Workgroup.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	self.users.broadcastWorg( null, event, sourceId, wrapSource );
}

ns.Workgroup.prototype.close = function() {
	const self = this;
	self.emitterClose();
	if ( self.db )
		self.db.close();
	
	
	if ( self.worgCtrl ) {
		if ( self.onWorgAddId ) {
			self.worgCtrl.off( self.onWorgAddId );
			self.onWorgAddId = null;
		}
		
		if ( self.onWorgRemoveId ) {
			self.worgCtrl.off( self.onWorgRemoveId );
			self.onWorgRemoveId = null;
		}
		
		if ( self.onWorgUsersRemovedId ) {
			self.worgCtrl.off( self.onWorgUsersRemovedId );
			self.onWorgUsersRemovedId = null;
		}
	}
	
	delete self.worgCtrl;
	delete self.roomId;
	delete self.db;
	delete self.users;
	delete self.settings;
	delete self.groups;
	delete self.fIds;
	delete self.list;
	delete self.stream;
	delete self.streamIds;
}

// private

ns.Workgroup.prototype.init = async function( dbPool ) {
	const self = this;
	self.db = new dFace.RoomDB( dbPool, self.roomId );
	
	self.settings.on( 'workgroups', handleWorgUpdate );
	function handleWorgUpdate( item, userId ) {
		self.updateAssigned( item, userId );
	}
	
	self.onWorgAddId = self.worgCtrl.on( 'added', worg =>
		self.handleWorgAdded( worg ));
	self.onWorgRemoveId = self.worgCtrl.on( 'removed', worg =>
		self.handleWorgRemoved( worg ));
	self.onWorgUsersRemovedId = self.worgCtrl.on( 'users-removed', ( worgId, removed ) =>
		self.handleUsersRemoved( worgId, removed ));
	
	const assigned = await self.worgCtrl.getAssignedForRoom( self.roomId );
	self.setDBAssigned( assigned );
	self.updateSettings();
}

ns.Workgroup.prototype.setDBAssigned = function( assigned ) {
	const self = this;
	assigned.forEach( add );
	self.fIds = Object.keys( self.assigned );
	let available = self.fIds.map( fId => {
		let wg = self.worgCtrl.getByFId( fId );
		if ( !wg )
			return null;
		
		return wg.clientId;
	});
	self.cIds = available.filter( id => !!id );
	
	function add( wg ) {
		const wId = wg.clientId;
		self.assigned[ wg.fId ] = wg;
		const uList = self.worgCtrl.getUserList( wId );
		uList.forEach( uId => {
			self.users.addForWorkgroup( wId, uId );
		});
	}
}

ns.Workgroup.prototype.handleWorgAdded = function( w ) {
	const self = this;
	const worg = self.worgCtrl.get( w.clientId );
	const added = {
		type : 'added',
		data : worg,
	};
	self.broadcast( added );
	
	const fId = worg.fId;
	if ( !self.assigned[ fId ])
		return;
	
	const wId = worg.clientId;
	if ( self.cIds.some( cId => cId === wId ))
		return;
	
	self.cIds.push( wId );
	self.updateSettings();
}

ns.Workgroup.prototype.handleWorgRemoved = function( worg ) {
	const self = this;
	const removed = {
		type : 'removed',
		data : worg.clientId,
	};
	self.broadcast( removed );
	const fId = worg.fId;
	if ( !self.assigned[ fId ])
		return;
	
	self.dismiss( worg );
}

ns.Workgroup.prototype.handleUsersRemoved = function( worgId, removed ) {
	const self = this;
	//const fId = self.worgCtrl.cIdToFid( worgId );
	if ( !removed || !removed.length )
		return;
	
	removed.forEach( uId => {
		self.users.removeFromWorg( worgId, uId );
	});
	
	self.removeUsers();
}

ns.Workgroup.prototype.updateSettings = function() {
	const self = this;
	let assigned = self.getAssignedClientIds();
	self.settings.updateWorkgroups( assigned );
}

ns.Workgroup.prototype.addAssigned = function( dbWorg ) {
	const self = this;
	const fId = dbWorg.fId;
	const worg = self.worgCtrl.getByFId( fId );
	const cId = worg.clientId;
	self.assigned[ fId ] = dbWorg;
	self.fIds.push( fId );
	self.cIds.push( cId );
	
	self.sendAssigned();
}

ns.Workgroup.prototype.removeDismissed = function( fId ) {
	const self = this;
	delete self.assigned[ fId ];
	self.fIds = Object.keys( self.assigned );
	self.cIds = self.fIds.map( fId => {
		let worg = self.worgCtrl.getByFId( fId );
		if ( !worg )
			return;
		
		return worg.clientId;
	}).filter( cId => !!cId );
	
	self.sendAssigned();
}

ns.Workgroup.prototype.sendAssigned = function() {
	const self = this;
	const update = {
		type : 'assigned',
		data : self.getAssigned(),
	};
	self.broadcast( update );
}

ns.Workgroup.prototype.removeUsers = function() {
	const self = this;
	const all = self.users.getList();
	let toBeRemoved = all.filter( checkNoAssigned );
	toBeRemoved.forEach( uid => self.emit( 'remove-user', uid ));
	
	function checkNoAssigned( userId ) {
		const wIds = self.users.getWorgsFor( userId );
		//wLog( 'checkNoAssigned - users worgs', [ userId, wIds ]);
		if ( !wIds || !wIds.length )
			return true;
		
		return false;
		//return !assForUser.length;
	}
}


// Settings - must be .initialize()'d after instanciation

const sLog = require( './Log' )( 'Room > Settings' );
ns.Settings = function(
	dbPool,
	worgCtrl,
	roomId,
	users,
	isPersistent,
	roomName,
) {
	const self = this;
	events.Emitter.call( self );
	
	self.dbPool = dbPool;
	self.roomName = roomName;
	
	self.roomId = roomId;
	self.worgCtrl = worgCtrl;
	self.users = users;
	self.isPersistent = isPersistent;
	
	self.setting = {};
	self.handlerMap = {};
	self.list = [];
}

ns.Settings.prototype.initialize = async function() {
	const self = this;
	const dbPool = self.dbPool;
	const roomName = self.roomName;
	delete self.dbPool;
	delete self.roomName;
	await self.init( dbPool, roomName );
}

util.inherits( ns.Settings, events.Emitter );

// Public

ns.Settings.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user || !user.on )
		return;
	
	user.on( 'settings', ( e, sourceId ) => {
		self.events.handle( e, userId, sourceId );
	});
}

ns.Settings.prototype.updateWorkgroups = function( assigned ) {
	const self = this;
	self.set( 'workgroups', {
		available : null,
		assigned  : assigned,
	});
}

ns.Settings.prototype.get = function( setting ) {
	const self = this;
	let settings = JSON.parse( self.settingStr );
	if ( settings.workgroups && self.worgCtrl ) {
		let available = self.worgCtrl.get();
		settings.workgroups.available = available;
	}
	
	if ( setting )
		return settings[ setting ] || null;
	else
		return settings;
}

ns.Settings.prototype.sendSaved = function( setting, value, success, userId ) {
	const self = this;
	const update = {
		type : 'update',
		data : {
			success : success,
			setting : setting,
			value   : value,
		},
	};
	if ( success )
		self.broadcast( update );
	else
		self.send( update, userId );
}

ns.Settings.prototype.sendError = function( setting, errMsg, userId ) {
	const self = this;
	const fail = {
		type : 'update',
		data : {
			success : false,
			errMsg  : errMsg,
			setting : setting,
			value   : null,
		},
	};
	self.send( fail, userId );
}

ns.Settings.prototype.send = function( event, userId, callback ) {
	const self = this;
	self.users.sendSettings( userId, event );
}

ns.Settings.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	self.users.broadcastSettings( null, event, sourceId, wrapSource );
}

ns.Settings.prototype.setPersistent = function( isPersistent ) {
	const self = this;
	self.isPersistent = isPersistent;
}

ns.Settings.prototype.setName = function( roomName ) {
	const self = this;
	return self.setRoomName( roomName );
}

ns.Settings.prototype.close = function() {
	const self = this;
	if ( self.db )
		self.db.close();
	
	delete self.worgCtrl;
	delete self.users;
	delete self.db;
	delete self.roomId;
	delete self.isPersistent;
}

// Private

ns.Settings.prototype.init = async function( dbPool, name ) {
	const self = this;
	self.handlerMap = {
		'roomName'    : roomName,
		'userLimit'   : userLimit,
		'isStream'    : isStream,
		'isRecording' : isRecording,
		'workgroups'  : worgs,
		'authorized'  : authRemove,
	};
	
	function roomName( e, uid ) { self.handleRoomName( e, uid ); }
	function userLimit( e, uid ) { self.handleUserLimit( e, uid ); }
	function isStream( e, uid  ) { self.handleStream( e, uid ); }
	function isRecording( e, uid ) { self.handleRecording( e, uid ); }
	function worgs( e, uid ) { self.handleWorgs( e, uid ); }
	function authRemove( e, uid ) { self.handleAuthRemove( e, uid ); }
	
	self.list = Object.keys( self.handlerMap );
	self.db = new dFace.RoomDB( dbPool, self.roomId );
	let dbSetts = null;
	try {
		dbSetts = await self.db.getSettings();
	} catch ( err ) {
		sLog( 'init db err getSettings()', err );
	}
	
	await self.normalizeSettings( dbSetts );
	self.set( 'roomName', name );
	
	self.events = new events.RequestNode( null, onSend, sSink, true );
	self.events.on( 'get', ( ...args ) => {
		return self.handleLoad( ...args );
	});
	self.events.on( 'save', ( ...args ) => {
		return self.saveSettings( ...args );
	});
	self.events.on( 'setting', ( ...args ) => self.saveSetting( ...args ));
	
	return self.setting;
	
	function onSend( event, userId ) {
		if ( userId )
			self.send( event, userId );
		else
			self.broadcast( event );
	}
	
	function sSink( ...args ) {
		sLog( 'sSink', args );
	}
}

ns.Settings.prototype.normalizeSettings = async function( db ) {
	const self = this;
	if ( db && ( null != db.isClassroom )) {
		if ( null == db.isStream )
			db.isStream = db.isClassroom;
		
		delete db.isClassroom;
		await self.db.removeSetting( 'isClassroom' );
		await self.db.setSetting( 'isStream', db.isStream );
	}
	
	const roomConf = global.config.server.room;
	const liveConf = global.config.server.live;
	const settings = {};
	const canRecord = self.checkHasProxy();
	if ( !canRecord ) {
		settings.isStream = undefined;
		settings.isRecording = undefined;
	} else {
		settings.isStream = checkNullValue( 'isStream', db, liveConf );
		settings.isRecording = checkNullValue( 'isRecording', db, liveConf );
	}
	
	settings.userLimit = checkUserLimit( db, liveConf );
	
	const keys = Object.keys( settings );
	
	keys.forEach( k => {
		const v = settings[ k ];
		self.setting[ k ] = v;
	});
	self.settingStr = JSON.stringify( self.setting );
	
	function checkNullValue( type, db, conf ) {
		let value = null;
		if ( db && ( null != db[ type ] ))
			value = db[ type ];
		else
			value = conf[ type ];
			
		if ( null == value )
			return undefined;
		
		return value;
	}
	
	function checkUserLimit( db, conf ) {
		let limit;
		if ( db && ( null != db.userLimit ))
			return db.userLimit;
		else
			return conf.userLimit || 0;
	}
}

ns.Settings.prototype.set = function( setting, value ) {
	const self = this;
	self.setting[ setting ] = value;
	self.settingStr = JSON.stringify( self.setting );
}

ns.Settings.prototype.handleLoad = async function( event, userId ) {
	const self = this;
	const values = self.get();
	if ( null != global.config.server.classroomProxy ) {
		values.isClassroom = values.isStream;
		delete values.isStream;
	}
	
	const isAdmin = self.checkIsAdmin( userId );
	if ( !isAdmin )
		delete values[ 'workgroups' ];
	
	if ( isAdmin )
		values.authorized = self.users.getAuthorized();
	
	return values;
}

ns.Settings.prototype.saveSetting = function( event, userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user )
		return;
	
	if ( !self.checkIsAdminOrOwner( userId )) {
		self.sendError( setting, 'ERR_NOT_ADMIN', userId );
		return;
	}
	
	const handler = self.handlerMap[ event.setting ];
	if ( !handler ) {
		sLog( 'saveSetting - no handler for ', event );
		return;
	}
	
	handler( event.value, userId );
}

ns.Settings.prototype.saveSettings = function( ...args ) {
	const self = this;
	sLog( 'saveSettings - NYI', args, 3 );
}

ns.Settings.prototype.checkHasProxy = function() {
	const self = this;
	const live = global.config.server.live;
	if ( live.webRTCProxy && live.webRTCProxy.length )
		return true;
	
	return false;
}

ns.Settings.prototype.checkIsAdminOrOwner = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user )
		return false;
	
	if ( !user.isAdmin && !user.isOwner )
		return false;
	else
		return true;
	
}

ns.Settings.prototype.checkIsAdmin = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user )
		return false;
	
	if ( !user.isAdmin )
		return false;
	else
		return true;
}

ns.Settings.prototype.handleRoomName = async function( name, userId ) {
	const self = this;
	const err = await self.setRoomName( name );
	if ( !userId )
		return err;
	
	if ( null == err )
		self.sendSaved( 'roomName', name, true, userId );
	else
		self.sendError( 'roomName', err, userId );
	
	return err;
}

ns.Settings.prototype.setRoomName = async function( name ) {
	const self = this;
	
	// TODO name/string checks
	
	if ( self.isPersistent ) {
		try {
			self.db.setName( name );
		} catch( ex ) {
			sLog( 'setRoomName - db fail', ex );
			return ex;
		}
	}
	
	self.set( 'roomName', name );
	self.emit( 'roomName', name );
	
	return null;
}

ns.Settings.prototype.handleUserLimit = function( value, userId ) {
	const self = this;
	self.db.setSetting( 'userLimit', value )
		.then( dbOk )
		.catch( dbErr );
	
	function dbOk() {
		self.set( 'userLimit', value );
		self.emit( 'userLimit', value );
		self.sendSaved( 'userLimit', value, true, userId );
	}
	
	function dbErr( err ) {
		sLog( 'handleUserLimit.dbErr', err );
		self.sendError( 'userLimit', err, userId );
	}
}

ns.Settings.prototype.handleStream = function( value, userId, isClassroom ) {
	const self = this;
	const canStream = self.checkHasProxy();
	if ( !canStream ) {
		sendErr( 'ERR_NO_PROXY' );
		return;
	}
	
	self.db.setSetting( 'isStream', value )
		.then( dbOk )
		.catch( dbErr );
	
	function dbOk( res ) {
		self.set( 'isStream', value );
		self.emit( 'isStream', value );
		self.sendSaved( 'isStream', value, true, userId );
		if ( isClassroom )
			self.sendSaved( 'isClassroom', value, true, userId );
	}
	
	function dbErr( err ) {
		sLog( 'handleStream.dbErr', err );
		sendErr( err );
		
	}
	
	function sendErr( err ) {
		self.sendError( 'isStream', err, userId );
		if ( isClassroom )
			self.sendError( 'isClassroom', err, userId );
	}
}

ns.Settings.prototype.handleRecording = function( value, userId ) {
	const self = this;
	const canRecord = self.checkHasProxy();
	if ( !canRecord ) {
		sendErr( 'ERR_NO_PROXY' );
		return;
	}
	
	self.db.setSetting( 'isRecording', value )
		.then( dbOk )
		.catch( dbErr );
	
	function dbOk() {
		self.set( 'isRecording', value );
		self.emit( 'isRecording', value );
		self.sendSaved( 'isRecording', value, true, userId );
	}
	
	function sendErr( err ) {
		self.sendError( 'isRecording', err, userId );
	}
}

ns.Settings.prototype.handleWorgs = function( worg, userId ) {
	const self = this;
	if ( !self.checkIsAdmin( userId ))
		return;
	
	self.emit( 'workgroups', worg, userId );
}

ns.Settings.prototype.handleAuthRemove = async function( event, userId ) {
	const self = this;
	self.emit( 'auth-remove', event.clientId );
	self.sendSaved( 'authorized', event, true, userId );
}

module.exports = ns;
