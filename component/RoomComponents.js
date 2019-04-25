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
const Janus = require( './Janus' );
const util = require( 'util' );

var ns = {};

const uLog = require( './Log' )( 'Room > Users' );
ns.Users = function(
	dbPool,
	roomId,
	isPersistent,
	workroomId
) {
	const self = this;
	events.Emitter.call( self );
	
	self.isPersistent = isPersistent;
	self.roomId = roomId;
	self.workId = workroomId;
	self.superId = null;
	
	self.everyone = {};
	self.everyId = [];
	self.notPersisted = [];
	self.online = [];
	self.active = [];
	self.authorized = [];
	self.guests = [];
	self.worgs = {};
	self.wIds = [];
	self.subs = {};
	self.subIds = [];
	self.viewGroups = [];
	self.viewers = {};
	self.viewerIds = [];
	self.lastRead = {};
	
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
		
	if ( !self.exists( cId )) {
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
	
	return true;
	
	function deny( user ) {
		uLog( 'set - user not set', {
			r     : self.workId,
			user  : user,
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
	
	if ( removedFromWorg ) {
		self.updateViewMembers();
		return user;
	}
	
	uLog( 'remove - not found in things', userId );
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
		return;
	
	self.online.splice( userIndex, 1 );
}

ns.Users.prototype.getOnline = function() {
	const self = this;
	return self.online;
}

ns.Users.prototype.addAuthorized = function( userId ) {
	const self = this;
	if ( self.checkIsAuthed( userId )) {
		uLog( 'addAuthorized - already', userId );
		throw new Error( 'Users.addAuthorized - already authed' );
	}
	
	self.authorized.push( userId );
}

ns.Users.prototype.checkIsAuthed = function( userId ) {
	const self = this;
	return self.authorized.some( uId => uId === userId );
}

ns.Users.prototype.removeAuth = function( userId ) {
	const self = this;
	const aIdx = self.authorized.indexOf( userId );
	if ( -1 === aIdx )
		return;
	
	self.authorized.splice( aIdx, 1 );
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
		return;
	
	worg.push( userId );
	self.updateViewMembers();
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

ns.Users.prototype.addGuest = function( userId ) {
	const self = this;
	if ( self.checkIsRegistered( userId )) {
		uLog( 'addGuest - already', userId );
		throw new Error( 'Users.addGuest - already registered' );
	}
	
	self.guests.push( userId );
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
	if ( !targets ) {
		self._broadcast( self.online, event, source, wrapInSource );
		return;
	}
	
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
	
	if ( self.msgDb )
		self.msgDb.close();
	
	delete self.msgDb;
	delete self.lastRead;
}

// Private

ns.Users.prototype.init = function( dbPool ) {
	const self = this;
	self.msgDb = new dFace.MessageDB( dbPool, self.roomId );
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
		uLog( 'could not send to', {
			r : self.workId,
			t : targetId,
			e : event,
		}, 3 );
		return;
	}
	
	user.send( event );
}

ns.Users.prototype._broadcast = function( targetList, event, source, wrapInSource ) {
	const self = this;
	if ( !targetList )
		targetList = self.online;
	
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
	if ( !global.config.server.workroom.subsHaveSuperView )
		return;
	
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
				if ( viewers[ uId ])
					return;
				
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
	
	user.on( 'chat', cat );
	function cat( e ) { self.handleChat( e, userId ); }
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
		'msg'     : msg,
		'log'     : log,
		'state'   : state,
		'confirm' : confirm,
		'request' : ( e, uid ) => self.handleRequest( e, uid ),
	};
	
	function msg( e, uid ) { self.createMsg( e, uid ); }
	function log( e, uid ) { self.handleLog( e, uid ); }
	function state( e, uid ) { self.handleState( e, uid ); }
	function confirm( e, uid ) { self.handleConfirm( e, uid ); }
}

ns.Chat.prototype.handleChat = function( event, userId ) {
	const self = this;
	var handler = self.eventMap[ event.type ];
	if ( !handler ) {
		cLog( 'unknown chat event', event );
		return;
	}
	
	handler( event.data, userId );
}

ns.Chat.prototype.handleRequest = async function( event, userId ) {
	const self = this;
	const reqId = event.requestId;
	const req = event.request;
	let res = null;
	let err = null;
	try {
		if ( 'edit-get' === req.type )
			res = await self.handleEditGet( req.data, userId );
		
		if ( 'edit-save' === req.type )
			res = await self.handleEditSave( req.data, userId );
		
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
		type : 'request',
		data : {
			type : 'response',
			data : {
				requestId : reqId,
				error     : err,
				response  : res,
			},
		},
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
	self.sendMsgNotification( message, mId, userId );
	self.broadcast( event );
}

ns.Chat.prototype.sendMsgNotification = async function( message, mId, fromId ) {
	const self = this;
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
	
	try {
		await self.service.sendNotification(
			userList,
			roomName,
			notie,
			self.roomId,
			extra
		);
	} catch ( err ) {
		cLog( 'sendMsgNotification - err', err );
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
	
	/*
	if ( wrapSource )
		event = {
			type : sourceId,
			data : event,
		};
	
	self.onlineList.forEach( sendTo );
	function sendTo( userId ) {
		if ( sourceId === userId )
			return;
		
		self.send( event, userId );
	}
	*/
}

ns.Chat.prototype.send = function( event, userId ) {
	const self = this;
	self.users.sendChat( userId, event );
	/*
	const user = self.users[ userId ];
	if ( !user ) {
		cLog( 'send - no user for userId', {
			uid : userId,
			users : Object.keys( self.users ),
		});
		return;
	}
	
	if ( !user.send ) // no .send() means an offline user
		return;
	
	const chat = {
		type : 'chat',
		data : event,
	};
	user.send( chat );
	*/
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
	self.quality = {
		level : 'medium',
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

ns.Live.prototype.add = async function( userId ) { //adds user to existing room
	const self = this;
	const user = self.users.get( userId );
	if ( !user )
		return;
	
	const pid = user.clientId;
	if ( self.peers[ pid ]) {
		await self.reAdd( pid );
		return;
	}
	
	if ( self.isStream ) {
		if ( null == self.proxy ) {
			self.setupStreamProxy();
		}
		
		if ( !self.sourceId && self.worgs ) {
			let isStreamer = self.worgs.isStreamer( userId );
			if ( isStreamer ) {
				self.sourceId = userId;
				self.proxy.set_source( userId );
				self.broadcast({
					type : 'source',
					data : self.sourceId,
				});
			}
		}
		
		self.proxy.add_user( userId );
		
	}
	
	self.peers[ pid ] = user;
	self.peerIds.push( pid );
	user.on( 'live', handleLive );
	
	const liveId = uuid.get( 'live' );
	user.liveId = liveId;
	// tell everyone
	self.sendJoin( pid );
	// tell peer
	self.sendOpen( pid, liveId );
	
	self.updateQualityScale();
	// tell user who else is in live
	//self.sendPeerList( pid );
	
	self.startPing( pid );
	
	function handleLive( e ) {
		self.handlePeerEvent( e, pid );
	}
}

ns.Live.prototype.restore = async function( userId ) {
	const self = this;
	if ( self.peers[ userId ])
		self.sendOpen( userId );
	else
		await self.add( userId );
	
	self.sendPeerList( userId );
}

ns.Live.prototype.remove = function( peerId, isReAdd ) { // userId
	//peerId is the same as userId
	const self = this;
	if ( self.mode && self.mode.data.owner === peerId )
		self.clearMode();
	
	if ( peerId === self.sourceId ) {
		self.sourceId = null;
		if ( self.proxy )
			self.proxy.set_source( null );
		
		self.broadcast({
			type : 'source',
			data : null,
		});
	}
	
	if ( self.proxy ) {
		if ( false == self.proxy.remove_user( peerId )) { //room is empty
			self.closeStreamProxy();
		}
	}
	
	const peer = self.getPeer( peerId );
	if ( !peer )
		return;
	
	self.stopPing( peerId );
	// tell the peer
	peer.liveId = null;
	// tell everyone else
	self.sendLeave( peerId );
	// remove & release
	delete self.peers[ peerId ];
	self.peerIds = Object.keys( self.peers );
	peer.release( 'live' );
	if ( isReAdd )
		return;
	
	self.sendClose( peerId, peer.liveId );
	self.updateQualityScale();
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
		self.closeStreamProxy();
	
	if ( self.settings && self.onStreamEventId )
		self.settings.off( self.onStreamEventId );
	
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
	self.isStream = self.settings.get( 'isStream' );
	self.onStreamEventId = self.settings.on( 'isStream', isStreamUpdated );
	function isStreamUpdated( isStream ) {
		self.isStream = isStream;
		if ( !isStream ) {
			self.closeStreamProxy();
			self.sourceId = null;
		}
		
		self.broadcast({
			type : 'source',
			data : self.sourceId,
		});
	}
	
	self.eventMap = {
		'pong'           : pong,
		'stream'         : stream,
		'broadcast'      : broadcast,
		'speaking'       : speaking,
		'quality'        : quality,
		'mode'           : mode,
		'leave'          : leave,
	};
	
	function pong(      e, pid ) { self.handlePong(      e, pid ); }
	function stream(    e, pid ) { self.handleStream(    e, pid ); }
	function broadcast( e, pid ) { self.handleBroadcast( e, pid ); }
	function quality(   e, pid ) { self.handleQuality(   e, pid ); }
	function mode(      e, pid ) { self.handleMode(      e, pid ); }
	function speaking(  e, pid ) { self.handleSpeaking(  e, pid ); }
	function leave(     e, pid ) { self.handleLeave(     e, pid ); }
	
}

ns.Live.prototype.reAdd = async function( pid ) {
	const self = this;
	if ( self.peerAddTimeouts[ pid ]){
		return; // already being re added
	}
	
	const peer = self.peers[ pid ];
	/*
	self.stopPing( pid );
	self.sendClose( pid, peer.liveId );
	peer.liveId = null;
	self.sendLeave( pid );
	delete self.peers[ pid ];
	self.peerIds = Object.keys( self.peers );
	peer.release( 'live' );
	*/
	self.remove( pid, true );
	await wait();
	self.add( pid );
	return true;
	
	function wait() {
		return new Promise(( resolve, reject ) => {
			self.peerAddTimeouts[ pid ] = setTimeout( teeOut, 100 );
			function teeOut() {
				let timeout = self.peerAddTimeouts[ pid ];
				if ( null == timeout )
					throw new Error( 'timeout canceled' );
				
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

ns.Live.prototype.handleStream = function( event, peerId ) {
	const self = this;
	if ( !self.proxy ) {
		lLog( 'handleStream - no proxy', event );
		return;
	}
	
	self.proxy.handle_signal( event, peerId );
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
	self.proxy = new Janus( jConf );
	self.proxy.on( 'signal', toSignal );
	self.proxy.on( 'closed', closed );
	
	function toSignal( e, uid ) { self.send( e, uid ); }
	function closed( e ) { self.proxyClosed( e ); }
}

ns.Live.prototype.closeStreamProxy = function() {
	const self = this;
	if ( !self.proxy )
		return;
	
	self.proxy.close( proxyClosed );
	delete self.proxy;
	function proxyClosed( reason ) {
		self.proxyClosed( reason );
	}
}

ns.Live.prototype.proxyClosed = function( reason ) {
	const self = this;
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

ns.Live.prototype.handleMode = function( event, peerId ) {
	const self = this;
	if ( 'presentation' === event.mode )
		self.togglePresentationMode( event, peerId );
}

ns.Live.prototype.clearMode = function() {
	const self = this;
	if ( !self.mode ) {
		self.sendMode({
			type : '',
		});
		return;
	}
	
	if ( 'presentation' === self.mode.type )
		self.togglePresentationMode();
}

ns.Live.prototype.togglePresentationMode = function( event, peerId ) {
	const self = this;
	if ( !peerId ) {
		unset();
		return;
	}
	
	if ( !allowChange( peerId ))
		return;
	
	if ( !self.mode )
		set( peerId );
	else
		unset();
	
	function set( presenterId ) {
		self.mode = {
			type : 'presentation',
			data : {
				owner : presenterId,
			},
		};
		self.sendMode( self.mode );
	}
	
	function unset() {
		self.mode = null;
		const update = {
			type : '',
		};
		self.sendMode( update );
	}
	
	function allowChange( peerId ) {
		if ( !self.mode )
			return true;
		
		if ( 'presentation' !== self.mode.type )
			return false;
		
		if ( self.mode.data.owner !== peerId )
			return false;
		
		return true;
	}
}

ns.Live.prototype.sendMode = function( event, peerId ) {
	const self = this;
	const mode = {
		type : 'mode',
		data : event,
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
		self.currentSpeaker = peerId;
		const speaking = {
			time       : event.time,
			peerId     : peerId,
			isSpeaking : true,
		};
		send( speaking );
	}
	
	function handleStoppedSpeaking( event, peerId ) {
		if ( peerId !== self.currentSpeaker )
			return;
		
		if ( self.speakerTimeout ) {
			clearTimeout( self.speakerTimeout );
			self.speakerTimeout = null;
		}
		
		const stopped = {
			time       : event.time,
			peerId     : peerId,
			isSpeaking : false,
		};
		send( stopped );
	}
	
	function send( event ) {
		let speaking = {
			type : 'speaking',
			data : event,
		};
		self.broadcast( speaking );
	}
	
	function clear() {
		self.speakerTimeout = null;
	}
}

ns.Live.prototype.handleLeave = function( event, peerId ) {
	const self = this;
	self.remove( peerId );
}

// things

ns.Live.prototype.updateQualityScale = function() {
	const self = this;
	const peers = self.peerIds.length;
	if ( null == self.lastScaleUpdate ) {
		self.lastScaleUpdate = 0;
		self.quality.scale = recalc( peers );
		self.updateQuality();
		return;
	}
	
	//lLog( 'lastScaleUpdate', self.lastScaleUpdate );
	//lLog( 'peers', peers );
	const change = peers - self.lastScaleUpdate;
	//lLog( 'change', change );
	let direction = ( 0 < change ) ? 1 : -1;
	//lLog( 'direction', direction )
	const delta = Math.abs ( change );
	//lLog( 'delta', delta );
	
	if ( !self.lastScaleDirection ) {
		//lLog( 'lastScaleDirection isnt set', self.lastScaleDirection );
		self.lastScaleDirection = 1;
	}
	
	if ( self.lastScaleDirection !== direction ) {
		//lLog( 'direction change', direction );
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
		data : self.peerIds,
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

ns.Live.prototype.sendOpen  = function( pid, liveId ) {
	const self = this;
	const open = {
		type : 'open',
		data : {
			liveId   : liveId,
			liveConf : {
				ICE      : global.config.shared.rtc.iceServers,
				userId   : pid,
				sourceId : self.sourceId,
				peerList : self.peerIds,
				quality  : self.quality,
				mode     : self.mode,
				logTail  : self.log.getLast( 20 ),
			},
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

ns.Live.prototype.sendClose = function( peerId, liveId ) {
	const self = this;
	const close = {
		type : 'close',
		data : liveId,
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
	/*
	if ( wrapSource )
		data = {
			type : sourceId,
			data : data,
		};
	
	self.peerIds.forEach( sendIfNotSource );
	function sendIfNotSource( pid ) {
		if ( pid === sourceId )
			return;
		
		self.send( data, pid );
	}
	*/
}

ns.Live.prototype.broadcastOnline = function( data, sourceId, wrapSource ) {
	const self = this;
	let online = self.users.getOnline();
	self.users.broadcastLive( online, data, sourceId, wrapSource );
	
	/*
	if ( wrapSource )
		data = {
			type : sourceId,
			data : data,
		};
	
	self.onlineList.forEach( sendIfNotSource );
	function sendIfNotSource( pid ) {
		if ( pid === sourceId )
			return;
		
		
		self.send( data, pid );
	}
	*/
}

ns.Live.prototype.send = function( event, targetId, callback ) {
	const self = this;
	self.users.sendLive( targetId, event );
	/*
	const target = self.getPeer( targetId );
	if ( !target ) {
		lLog( 'send - no peer for id', targetId );
		lLog( 'send - tried to send', event );
		return;
	}
	
	if ( !target.send ) {
		lLog( 'send - user is no online', target );
		lLog( 'send - tried to send', event );
		return;
	}
	
	const wrap = {
		type : 'live',
		data : event,
	};
	
	target.send( wrap, callback );
	*/
}

//
// INVITE

const iLog = require( './Log' )( 'Room > Invite' );
ns.Invite = function(
		dbPool,
		roomId,
		users,
		online,
		isPersistent
) {
	const self = this;
	self.roomId = roomId;
	self.users = users;
	self.isPersistent = isPersistent;
	
	self.publicToken = null;
	self.tokens = {};
	
	self.eventMap = null;
	
	self.init( dbPool, roomId );
}

// Public

ns.Invite.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user || !user.on )
		return;
	
	user.on( 'invite', invite );
	function invite( e ) { self.handle( e, userId ); }
}

ns.Invite.prototype.release = function( userId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user || !user.release )
		return;
	
	user.release( 'invite' );
}

ns.Invite.prototype.authenticate = async function( token ) {
	const self = this;
	if ( self.publicToken && ( token === self.publicToken.value ))
		return true;
	
	const hasToken = self.tokens[ token ];
	if ( hasToken ) {
		await self.revokeToken( token );
		return true;
	}
	
	let valid = null;
	try {
		valid = await self.checkDbToken( token );
	} catch ( e ) {
		valid = false;
	}
	
	if ( valid ) {
		await self.revokeToken( token );
	}
	
	return valid;
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
	self.loadPublicToken();
	
	self.eventMap = {
		'state'   : state,
		'public'  : publicSet,
		'private' : privateSet,
		'revoke'  : revoke,
	};
	
	function state( e, uid ) { self.handleState( e, uid ); }
	function publicSet( e, uid ) { self.handlePublic( e, uid ); }
	function privateSet( e, uid ) { self.handlePrivate( e, uid ); }
	function revoke( e, uid ) { self.handleRevoke( e, uid ); }
}

ns.Invite.prototype.loadPublicToken = function() {
	const self = this;
	self.db.getForRoom()
		.then( tokensBack )
		.catch( dbFail );
		
	function tokensBack( dbTokens ) {
		dbTokens.some( setPublic );
		function setPublic( dbToken ) {
			if ( dbToken.singleUse ) // private token
				return false;
			
			self.publicToken = {
				value : dbToken.token,
				by    : dbToken.createdBy,
			};
			
			return true;
		}
	}
	
	function dbFail( err ) {
		iLog( 'loadPublicToken - db error', err );
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
	const pubToken = self.publicToken || {};
	const state = {
		type : 'state',
		data : {
			publicToken   : pubToken.value,
			privateTokens : tokenList,
			host          : self.getInviteHost(),
		},
	};
	self.send( state, userId );
}

ns.Invite.prototype.handlePublic = function( event, userId ) {
	const self = this;
	event = event || {};
	if ( self.publicToken )
		returnToken( event.reqId );
	else
		setPublicToken( event.reqId, userId );
	
	function returnToken( reqId ) {
		const pub = {
			type : 'public',
			data : {
				token : self.publicToken.value,
				host  : self.getInviteHost(),
				reqId : reqId || null,
			},
		};
		self.broadcast( pub );
	}
	
	function setPublicToken( reqId, userId ) {
		self.createToken( false, userId, tokenBack );
		function tokenBack( err, token ) {
			if ( err ) {
				iLog( 'setPublicToken - db error', err );
				token = null;
			}
			
			self.publicToken = {
				value : token,
				by    : userId,
			};
			returnToken( reqId );
		}
	}
}

ns.Invite.prototype.handlePrivate = function( event, userId ) {
	const self = this;
	event = event || {};
	self.createToken( true, userId, tokenBack );
	function tokenBack( err, token ) {
		if ( token && !self.isPersistent )
			self.tokens[ token ] = {
				value : token,
				by    : userId,
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
}

ns.Invite.prototype.createToken =  function( isSingleUse, createdBy, callback ) {
	const self = this;
	const pre = !isSingleUse ? 'pub' : 'priv';
	let token = uuid.get( pre );
	if ( !self.isPersistent ) {
		callback( null, token );
		return;
	}
	
	self.db.set( token, isSingleUse, createdBy )
		.then( success )
		.catch( fail );
	
	function success( res ) {
		callback( null, token );
	}
	
	function fail( err ) {
		iLog( 'createToken.trySetToken.fail', err );
		callback( err, null );
	}
}

ns.Invite.prototype.persistCurrentTokens = async function() {
	const self = this;
	if ( !self.isPersistent )
		return;
	
	let pubSuccess = false;
	if ( self.publicToken ) {
		let pubToken = self.publicToken;
		try {
			pubSuccess = await self.db.set( pubToken.value, false, pubToken.by );
		} catch( err ) {
			iLog( 'failed to persist public token', err );
		}
	}
	
	let privTokens = Object.keys( self.tokens );
	privTokens.forEach( persist );
	async function persist( token ) {
		let meta = self.tokens[ token ];
		try {
			await self.db.set( meta.value, true, meta.by );
		} catch( err ) {
			iLog( 'failed to persist private token', err );
		}
		
		delete self.tokens[ token ];
	}
}

ns.Invite.prototype.handleRevoke = function( token, userId ) {
	const self = this;
	// TODO guest check here
	self.revokeToken( token, userId )
		.then(( ok ) => {});
}

ns.Invite.prototype.revokeToken = async function( token, userId ) {
	const self = this;
	let ok = false;
	if ( 'public' === token || ( self.publicToken && ( self.publicToken.value === token ) ))
		ok = await revokePublic( token, userId );
	else
		ok = await revoke( token, userId );
	
	return ok;
	
	async function revoke( token, userId ) {
		delete self.tokens[ token ];
		
		try {
			await invalidateDbToken( token, userId );
		} catch( e ) {
			iLog( 'revokeToken - failed to revoke DB token', e );
			return false;
		}
		
		broadcastRevoke( token );
		return true;
	}
	
	async function revokePublic( token, userId ) {
		if ( self.publicToken )
			token = self.publicToken.value;
		
		self.publicToken = null;
		try {
			await invalidateDbToken( token, userId );
		} catch ( e ) {
			iLog( 'revokeToken - failed to revoke DB token', e );
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

ns.Log.prototype.get = function( conf ) {
	const self = this;
	return new Promise( logs );
	function logs( resolve, reject ) {
		if ( null == conf ) {
			let logs = {
				type : 'before',
				data : {
					events : self.items,
					ids    : self.ids,
				},
			};
			resolve( logs );
		} else
			self.load( conf )
				.then( resolve )
				.catch( err );
		
		function err( err ) {
			llLog( 'load error', err.stack || err );
			resolve( null );
		}
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
	try {
		unknownIds = await self.getUnknownIdentities( events );
	} catch ( e ) {
		llLog( 'getunown e', e );
	}
	
	let log = {
		type : type,
		data : {
			events : events,
			ids    : unknownIds,
		},
	};
	return log;
	
}

ns.Log.prototype.getUnknownIdentities = async function( events ) {
	const self = this;
	if ( !events || !events.length )
		return null;
	
	const unknownIds = {};
	const start = Date.now();
	await Promise.all( events.map( check ));
	const end = Date.now();
	const total = end - start;
	/*
	llLog( 'getUnknwon completed in ( ms ):', {
		length : events.length,
		time   : total,
		start  : start,
		end    : end,
	}, 3 );
	*/
	return unknownIds;
	
	async function check( event ) {
		const msg = event.data;
		//llLog( 'msg', msg );
		let uId = msg.fromId;
		//llLog( 'checking', uId );
		if ( !uId )
			return;
		
		if ( unknownIds[ uId ])
			return;
		
		let user = self.users.get( uId );
		if ( user )
			return;
		
		unknownIds[ uId ] = true;
		let id = await self.idCache.get( uId );
		unknownIds[ uId ] = id;
		return;
	}
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
}

util.inherits( ns.Workgroup, events.Emitter );

ns.Workgroup.prototype.initialize = async function() {
	const self = this;
	const dbPool = self.dbPool;
	delete self.dbPool;
	await self.init( dbPool );
}

// 

ns.Workgroup.prototype.get = function() {
	const self = this;
	const all = {
		available : self.getAvailable(),
		assigned : self.getAssigned(),
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
	self.setAssigned( assigned );
	self.updateSettings();
}

ns.Workgroup.prototype.setAssigned = function( assigned ) {
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
	
	const update = {
		type : 'assigned',
		data : self.getAssigned(),
	};
	self.broadcast( update );
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
}

ns.Workgroup.prototype.removeUsers = function() {
	const self = this;
	const all = self.users.getList();
	let toBeRemoved = all.filter( checkNoAssigned );
	toBeRemoved.forEach( uid => self.emit( 'remove-user', uid ));
	
	function checkNoAssigned( userId ) {
		const wIds = self.users.getWorgsFor( userId );
		wLog( 'checkNoAssigned - users worgs', [ userId, wIds ]);
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
	
	user.on( 'settings', loadSettings );
	user.on( 'setting', saveSetting );
	
	function loadSettings( e ) { self.handleLoad( e, userId ); }
	function saveSetting( e ) { self.saveSetting( e, userId ); }
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

ns.Settings.prototype.setPersistent = function( isPersistent, roomName ) {
	const self = this;
	self.isPersistent = isPersistent;
	self.handleRoomName( roomName );
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
		'isClassroom' : isClassroom,
		'workgroups'  : worgs,
	};
	
	function roomName( e, uid ) { self.handleRoomName( e, uid ); }
	function userLimit( e, uid ) { self.handleUserLimit( e, uid ); }
	function isStream( e, uid  ) { self.handleStream( e, uid ); }
	function isClassroom( e, uid ) { self.handleClassroom( e, uid ); }
	function worgs( e, uid ) { self.handleWorgs( e, uid ); }
	
	self.list = Object.keys( self.handlerMap );
	self.db = new dFace.RoomDB( dbPool, self.roomId );
	let dbSetts = null;
	try {
		dbSetts = await self.db.getSettings();
	} catch ( err ) {
		self.setDefaults();
	}
	
	if ( dbSetts )
		self.setDbSettings( dbSetts );
	
	self.set( 'roomName', name );
	
	return self.setting;
	
	/*
	function settings( res ) {
		self.setDbSettings( res );
		self.set( 'roomName', name );
		done();
	}
	
	function loadErr( err ) {
		self.setDefaults();
		done( err );
	}
	
	function done( err ) {
		callback( err, self.setting );
	}
	*/
}

ns.Settings.prototype.setDbSettings = function( settings ) {
	const self = this;
	if ( settings.isClassroom ) {
		settings.isStream = settings.isClassroom;
		delete settings.isClassroom;
		self.db.removeSetting( 'isClassroom' );
	}
	
	settings.userLimit = settings.userLimit == null ? 0 : settings.userLimit;
	if ( streamingEnabled( global.config.server )) {
		settings.isStream = settings.isStream == null ? false : settings.isStream;
	}
	else {
		delete settings.isStream;
	}
	
	let keys = Object.keys( settings );
	keys.forEach( add );
	self.settingStr = JSON.stringify( self.setting );
	
	function add( key ) {
		let value = settings[ key ];
		self.setting[ key ] = value;
	}
	
	function streamingEnabled( conf ) {
		if ( conf.streamProxy && conf.streamProxy.length )
			return true;
		
		if ( conf.classroomProxy && conf.classroomProxy.length )
			return true;
		
		return false;
	}
}

ns.Settings.prototype.setDefaults = function() {
	const self = this;
	self.set( 'userLimit', 0 );
	self.set( 'isStream', false );
}

ns.Settings.prototype.set = function( setting, value ) {
	const self = this;
	self.setting[ setting ] = value;
	self.settingStr = JSON.stringify( self.setting );
}

ns.Settings.prototype.handleLoad = function( event, userId ) {
	const self = this;
	const values = self.get();
	if ( null != global.config.server.classroomProxy ) {
		values.isClassroom = values.isStream;
		delete values.isStream;
	}
	
	if ( !self.checkIsAdmin( userId ))
		delete values[ 'workgroups' ];
	
	self.send( values, userId );
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

ns.Settings.prototype.handleRoomName = function( value, userId ) {
	const self = this;
	self.db.setName( value )
		.then( ok )
		.catch( fail );
	
	function ok() {
		self.set( 'roomName', value );
		self.emit( 'roomName', value );
		if ( !userId )
			return;
		
		self.sendSaved( 'roomName', value, true, userId );
	}
	
	function fail( err ) {
		sLog( 'failed to set roomName', err );
		if ( !userId )
			return;
		
		self.sendError( 'roomName', err, userId );
	}
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
		self.sendError( 'isStream', err, userId );
		if ( isClassroom )
			self.sendError( 'isClassroom', err, userId );
	}
}

ns.Settings.prototype.handleClassroom = function( value, userId ) {
	const self = this;
	self.handleStream( value, userId, 'isClassroom' ) ;
}

ns.Settings.prototype.handleWorgs = function( worg, userId ) {
	const self = this;
	if ( !self.checkIsAdmin( userId ))
		return;
	
	self.emit( 'workgroups', worg, userId );
}

module.exports = ns;
