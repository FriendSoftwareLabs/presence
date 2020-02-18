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

const log = require( './Log' )( 'Room' );
const uuid = require( './UuidPrefix' )( 'msg' );
const Emitter = require( './Events' ).Emitter;
const WebRTCProxy = require( './WebRTCProxy' );
const components = require( './RoomComponents' );
const Signal = require( './Signal' );
const dFace = require( './DFace' );
const Janus = require( './Janus' );
const util = require( 'util' );
const FService = require( '../api/FService' );

const ns = {};

/* Room

*/
ns.Room = function( conf, db, idCache, worgCtrl ) {
	const self = this;
	if ( !conf.clientId )
		throw new Error( 'Room - clientId missing' );
	
	self.id = conf.clientId;
	self.ownerId = conf.ownerId;
	self.name = conf.name || null;
	self.avatar = conf.avatar;
	self.isPrivate = !!conf.isPrivate;
	self.persistent = conf.persistent || false;
	self.guestAvatar = conf.guestAvatar;
	self.dbPool = db;
	self.idCache = idCache;
	
	self.open = false;
	self.invite = null;
	self.log = null;
	self.chat = null;
	self.live = null;
	self.worgs = null;
	self.settings = null;
	self.users = null;
	self.authorized = [];
	self.accessKey = null;
	self.roomDb = null;
	self.emptyTimeout = 1000 * 20;
	self.emptyTimer = null;
	
	Emitter.call( self );
	
	self.init( worgCtrl );
}

util.inherits( ns.Room, Emitter );

// Public

ns.Room.prototype.getInfo = function() {
	const self = this;
	const info = {
		clientId : self.id,
		name     : self.name,
		avatar   : self.avatar,
	};
	return info;
}

ns.Room.prototype.getClientId = function() {
	const self = this;
	return self.id;
}

ns.Room.prototype.getPublicToken = async function( userId ) {
	const self = this;
	return await self.invite.getPublicToken( userId );
}

// when users come online
ns.Room.prototype.connect = async function( userId ) {
	const self = this;
	if ( !self.users.exists( userId )) {
		log( 'connect - user not added yet', {
			u : userId,
			l : self.users.getList(),
			r : self.workgroupId || self.name,
		});
		const added = await self.addUser( userId );
		if ( !added )
			return null;
	}
	
	const signal = await self.bindUser( userId );
	if ( self.emptyTimer ) {
		clearTimeout( self.emptyTimer );
		self.emptyTimer = null;
	}
	
	return signal;
}

// when user goes offline
ns.Room.prototype.disconnect = async function( userId ) {
	const self = this;
	const isAuthed = self.checkIsAuthed( userId );
	const isWorged = self.worgs.checkHasWorkgroup( userId );
	if ( isAuthed || isWorged )
		await self.releaseUser( userId );
	else
		await self.removeUser( userId );
	
	return userId;
}

// for real accounts, not for guests
// authorizes an account to connect to this room
ns.Room.prototype.authorizeUser = async function( userId ) {
	const self = this;
	const ok = await self.persistAuthorization( userId );
	if ( !ok )
		return false;
	
	await self.addUser( userId );
	return true;
}

// add a list of users
ns.Room.prototype.addUsers = async function( userList, worgId ) {
	const self = this;
	if ( !userList || !userList.length )
		return;
	
	await Promise.all( userList.map( uId => self.addUser( uId, worgId )));
}

ns.Room.prototype.addUser = async function( userId, worgId ) {
	const self = this;
	let user = await self.idCache.get( userId );
	if ( !user )
		return false;
	
	if ( user.isGuest )
		self.users.addGuest( userId );
	
	const exists = self.users.exists( userId );
	if ( exists )
		return;
	
	if ( worgId )
		self.users.addForWorkgroup( worgId, userId );
	
	const added = await self.users.set( user );
	if ( !added )
		return false;
	
	announce( user );
	self.onJoin( userId );
	
	return userId;
	
	function announce( user ) {
		// tell peoples
		const uId = user.clientId;
		const joinEvent = {
			type : 'join',
			data : {
				clientId   : uId,
				isAuthed   : self.checkIsAuthed( uId ),
				workgroups : self.worgs.getUserWorkgroupList( uId ),
			},
		};
		self.users.broadcast( null, joinEvent, uId );
	}
}

ns.Room.prototype.removeUsers = async function( userList, worgId ) {
	const self = this;
	if ( !userList || !userList.length )
		return;
	
	await Promise.all( userList.map( uId => self.removeUser( uId, worgId )));
}

// remove a users access to this room, and disconnect them from it if
// they  are currently online. User is removed from users list in client
ns.Room.prototype.removeUser = async function( userId, worgId ) {
	const self = this;
	const user = self.users.get( userId );
	if ( !user ) {
		log( 'removeUser - invalid user', {
			aid : userId,
			usr : self.users.getList(),
		}, 3 );
		return false;
	}
	
	// unbind / set offline
	await self.releaseUser( userId );
	
	// tell everyone
	const leave = {
		type : 'leave',
		data : userId,
	};
	self.users.broadcast( null, leave, userId );
	self.revokeAuthorization( userId );
	self.users.remove( userId );
	if ( user.close ) {
		user.close();
	}
	
	self.onLeave( userId );
	
	return true;
}

ns.Room.prototype.setUserDisabled = function( userId, isDisabled ) {
	const self = this;
	if ( isDisabled )
		remove( userId );
	else
		add( userId );
	
	async function remove( uId ) {
		await self.releaseUser( uId );
		self.users.remove( uId );
		const leave = {
			type : 'leave',
			data : uId,
		};
		self.users.broadcast( null, leave, userId );
	}
	
	function add( uId ) {
		self.users.addAuthorized( uId );
		self.addUser( uId );
	}
}

ns.Room.prototype.authenticateInvite = async function( token, userId ) {
	const self = this;
	let valid = false;
	try {
		valid = await self.invite.authenticate( token, userId );
	} catch ( e ) {
		log( 'authenticateInvite - failed', e );
	}
	
	return valid;
}

ns.Room.prototype.close = async function() {
	const self = this;
	self.open = false;
	
	if ( self.roomDb )
		self.roomDb.close();
	
	if ( self.live )
		self.live.close();
	
	if ( self.invite )
		self.invite.close();
	
	if ( self.chat )
		self.chat.close();
	
	if ( self.log )
		self.log.close();
	
	if ( self.worgs )
		self.worgs.close();
	
	if ( self.settings )
		self.settings.close();
	
	if ( self.users )
		self.users.close();
	
	self.emitterClose();
	
	delete self.live;
	delete self.invite;
	delete self.chat;
	delete self.log;
	delete self.worgs;
	delete self.settings;
	delete self.authorized;
	delete self.users;
	delete self.idCache;
	delete self.dbPool;
	delete self.service;
	delete self.onempty;
}

// Private

ns.Room.prototype.init = async function( worgCtrl ) {
	const self = this;
	self.service = new FService();
	self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
	self.users = new components.Users(
		self.dbPool,
		self.id,
		self.persistent
	);
	await self.users.initialize();
	
	self.settings = new components.Settings(
		self.dbPool,
		worgCtrl,
		self.id,
		self.users,
		self.persistent,
		self.name,
	);
	await self.settings.initialize();
	self.settings.on( 'roomName', e => self.handleRename( e ));
	self.settings.on( 'auth-remove', e => self.handleAuthRemove( e ));
	
	self.worgs = new components.Workgroup(
		worgCtrl,
		self.dbPool,
		self.id,
		self.users,
		self.settings,
	);
	await self.worgs.initialize();
	self.worgs.on( 'remove-user', removeUser );
	self.worgs.on( 'dismissed', worgDismissed );
	self.worgs.on( 'assigned', worgAssigned );
	
	function removeUser( e ){ self.handleRemovedFromWorgs( e ); }
	function worgDismissed( e ) { self.handleWorkgroupDismissed( e ); }
	function worgAssigned( e ) { self.emit( 'workgroup-assigned', e ); }
	
	self.log = new components.Log(
		self.dbPool,
		self.id,
		self.users,
		self.idCache,
		self.persistent,
	);
	await self.log.initialize();
	
	self.invite = new components.Invite(
		self.dbPool,
		self.id,
		self.users,
		self.persistent
	);
	self.invite.on( 'add', e => self.emit( 'invite-add', e ));
	
	self.chat = new components.Chat(
		self.id,
		self.name,
		self.users,
		self.log,
		self.service
	);
	
	self.live = new components.Live(
		self.users,
		self.log,
		self.worgs,
		self.settings
	);
	
	if ( self.persistent )
		await self.loadUsers();
	
	self.setOpen();
}

ns.Room.prototype.handleRemovedFromWorgs = function( userId ) {
	const self = this;
	if ( self.checkIsAuthed( userId ))
		return;
	
	self.removeUser( userId );
}

ns.Room.prototype.handleWorkgroupDismissed = function( worg ) {
	const self = this;
	self.emit( 'workgroup-dismissed', worg );
}

ns.Room.prototype.handleInviteAdd = function( invted ) {
	const self = this;
}

ns.Room.prototype.setOpen = function() {
	const self = this;
	self.open = true;
	setTimeout( emitOpen, 1 );
	function emitOpen() {
		self.emit( 'open', Date.now());
	}
}

ns.Room.prototype.loadUsers = async function() {
	const self = this;
	let auths = null;
	try {
		auths = await self.roomDb.loadAuthorizationsForRoom( self.id );
	} catch( err ) {
		log( 'loadUsers - db fail', err );
		return false;
	}
	
	if ( auths && auths.length )
		await Promise.all( auths.map( addFromDb ));
	
	const uListBy = self.worgs.getUserList();
	if ( uListBy && uListBy.length )
		await Promise.all( uListBy.map( addWorgUser ));
	
	return true;
	
	async function addFromDb( userId ) {
		self.users.addAuthorized( userId );
		await self.addUser( userId );
	}
	
	async function addWorgUser( uId ) {
		await self.addUser( uId );
	}
}

ns.Room.prototype.checkOnline = function() {
	const self = this;
	const online = self.users.getOnline();
	if ( 0 !== online.length )
		return;
	
	if ( self.emptyTimer )
		return;
	
	self.emptyTimer = setTimeout( roomIsEmpty, self.emptyTimeout );
	function roomIsEmpty() {
		self.emptyTimer = null;
		if ( !self.users ) {
			log( 'roomIsEmpty - no users', {
				id   : self.id,
				name : self.name,
			});
			return;
		}
		
		const alsoOnline = self.users.getOnline();
		if ( alsoOnline && ( 0 !== alsoOnline.length ))
			return; // someone joined during the timer. Lets not then, i guess
		
		self.emit( 'empty', Date.now());
		//self.onempty();
	}
}

// room events

ns.Room.prototype.bindUser = async function( userId ) {
	const self = this;
	let user = self.users.get( userId );
	if ( !user ) {
		log( 'bindUSer - not a user in room', {
			room : self.name,
			userId : userId,
			users  : self.users.getList(),
		}, 4 );
		try {
			throw new Error( 'blah' );
		} catch( e ) {
			log( 'trace', e.stack || e );
		}
		return null;
	}
	
	if ( user.close ) {
		log( 'bindUser - user already bound', {
			room   : self.name,
			user   : user.name,
		}, 3 );
		return user;
	}
	
	const uId = user.clientId;
	// add signal user obj
	const sigConf = {
		roomId     : self.id,
		roomName   : self.name,
		isPrivate  : self.isPrivate,
		persistent : self.persistent,
		roomAvatar : self.avatar,
		clientId   : uId,
		name       : user.name,
		fUsername  : user.fUsername,
		avatar     : user.avatar,
		isOwner    : uId === self.ownerId,
		isAdmin    : user.isAdmin,
		isAuthed   : self.checkIsAuthed( uId ),
		isGuest    : user.isGuest,
	};
	user = new Signal( sigConf );
	await self.users.set( user );
	
	// bind room events
	user.on( 'initialize', init );
	user.on( 'persist', persist );
	user.on( 'disconnect', goOffline );
	user.on( 'leave', leaveRoom );
	user.on( 'live-join', joinLive );
	user.on( 'live-restore', restoreLive );
	user.on( 'live-leave', leaveLive );
	user.on( 'active', active );
	
	let uid = userId;
	function init( e ) { self.initialize( e, uid ); }
	function persist( e ) { self.handlePersist( e, uid ); }
	function goOffline( e ) { self.disconnect( uid ); }
	function leaveRoom( e ) { self.unAuthUser( uid ); }
	function joinLive( e ) { self.handleJoinLive( e, uid ); }
	function restoreLive( e ) { self.handleRestoreLive( e, uid ); }
	function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
	function active( e ) { self.handleActive( e, uid ); }
	
	// add to components
	self.invite.bind( userId );
	self.chat.bind( userId );
	self.settings.bind( userId );
	
	self.users.setOnline( userId );
	return user;
}

ns.Room.prototype.getRoomRelation = async function( userId ) {
	const self = this;
	const unread = await self.log.getUnreadForUser( userId );
	const lastMessages = self.log.getLast( 1 );
	const relation = {
		unreadMessages : unread,
		lastMessage    : lastMessages[ 0 ],
	};
	
	return relation;
}

ns.Room.prototype.checkIsAuthed = function( userId ) {
	const self = this;
	if ( !self.persistent )
		return true;
	
	return self.users.checkIsAuthed( userId );
}

ns.Room.prototype.initialize = async function( requestId, userId ) {
	const self = this;
	const relation = await self.getRoomRelation( userId );
	const state = {
		id          : self.id,
		name        : self.name,
		ownerId     : self.ownerId,
		persistent  : self.persistent,
		settings    : self.settings.get(),
		guestAvatar : self.guestAvatar,
		users       : buildBaseUsers(),
		online      : self.users.getOnline(),
		peers       : self.live.getPeers(),
		workgroups  : self.worgs.get(),
		relation    : relation,
	};
	
	const init = {
		type : 'initialize',
		data : state,
	};
	
	self.send( init, userId );
	
	function buildBaseUsers() {
		const users = {};
		const uIds = self.users.getList();
		uIds.forEach( build );
		return users;
		
		function build( uId ) {
			let user = self.users.get( uId );
			users[ uId ] = {
				clientId   : uId,
				isAuthed   : self.checkIsAuthed( uId ),
				workgroups : self.worgs.getUserWorkgroupList( uId ),
			};
		}
	}
}

ns.Room.prototype.handlePersist = function( event, userId ) {
	const self = this;
	if ( self.persistent )
		return;
	
	if ( !event.name || !event.name.length )
		return;
	
	self.persistent = true;
	self.users.setPersistent( self.persistent );
	self.name = event.name;
	self.persistRoom( persistBack );
	function persistBack( res ) {
		if ( !res )
			return;
		
		const online = self.users.getOnline();
		self.settings.setPersistent( true, self.name );
		self.log.setPersistent( true );
		self.invite.setPersistent( true );
		online.forEach( update );
		function update( userId ) {
			const user = self.users.get( userId );
			if ( !user || !user.setRoomPersistent )
				return;
			
			user.setRoomPersistent( true, event.name );
		}
	}
}

ns.Room.prototype.persistRoom = function( callback ) {
	const self = this;
	let authorize = null;
	self.roomDb.set(
		self.id,
		self.name,
		self.ownerId
	)
		.then( roomOk )
		.catch( err );
		
	function roomOk( res ) {
		persistAuths();
	}
	
	function persistAuths() {
		const userIds = self.users.getList();
		authorize = userIds.filter( notGuest );
		authorize.forEach( uId => self.users.addAuthorized( uId ));
		self.roomDb.authorize( self.id, authorize )
			.then( authSet )
			.catch( err );
	}
	
	function notGuest( uid ) {
		const user = self.users.get( uid );
		return !user.isGuest;
	}
	
	function authSet( ok ) {
		authorize.forEach( updateClients );
		callback( ok );
	}
	
	function err( err ) {
		log( 'persistRoom err', err );
		callback( null );
	}
	
	function updateClients( userId ) {
		self.updateUserAuthorized( true, userId );
	}
}

ns.Room.prototype.persistAuthorization = async function( userId ) {
	const self = this;
	let success = true;
	if ( self.persistent ) {
		const accIds = [ userId ];
		const success = await self.roomDb.authorize( self.id, accIds );
	}
	
	if ( !success )
		return false;
	
	self.users.addAuthorized( userId );
	return true;
}

ns.Room.prototype.revokeAuthorization = async function( userId ) {
	const self = this;
	self.users.removeAuth( userId );
	const revoked = await self.roomDb.revoke( self.id, userId )
	return true;
}

// tell the user / client, it has been authorized for this room
ns.Room.prototype.updateUserAuthorized = function( isAuthed, userId ) {
	const self = this;
	const user = self.users.get( userId );
	user.setIsAuthed( isAuthed );
}

ns.Room.prototype.handleRename = async function( name, userId ) {
	const self = this;
	self.name = name;
	const online = self.users.getOnline();
	online.forEach( uId => {
		let user = self.users.get( uId );
		if ( !user.roomName )
			return;
		
		user.roomName = name;
	});
	
	await self.setAvatar();
	const uptd = {
		type : 'room-update',
		data : {
			clientId : self.id,
			name     : self.name,
			avatar   : self.avatar,
		},
	};
	
	self.broadcast( uptd );
}

ns.Room.prototype.handleAuthRemove = function( userId ) {
	const self = this;
	self.unAuthUser( userId );
}

ns.Room.prototype.setAvatar = async function() {
	const self = this;
	const tiny = require( './TinyAvatar' );
	self.avatar = await tiny.generate( self.name, 'block' );
}

// cleans up a users signal connection to this room
ns.Room.prototype.releaseUser = async function( userId ) {
	const self = this;
	let user = self.users.get( userId );
	if ( !user ) {
		log( 'releaseUser - no user', {
			u : userId,
			users : self.users.getList(),
		}, 3 );
		return;
	}
	
	if ( !user.close ) // not signal, so not bound
		return;
	
	if ( self.live )
		self.live.remove( userId );
	
	self.users.setActive( false, userId );
	self.users.setOffline( userId );
	const id = await self.idCache.get( userId );
	await self.users.set( id )
	// no need to release each event, .release() is magic
	user.release();
	user.close();
	self.checkOnline();
}

ns.Room.prototype.onJoin = function( userId ) {
	const self = this;
}

ns.Room.prototype.onLeave = function( userId ) {
	const self = this;
}

ns.Room.prototype.unAuthUser = async function( uid ) {
	const self = this;
	// check if user is authorized, if so, remove
	const isAuthorized = await self.roomDb.check( uid );
	if ( isAuthorized ) {
		await self.revokeAuthorization( uid );
	}
	else {
		const user = self.users.get( uid );
		user.authed = false;
	}
	
	const user = self.users.get( uid );
	if ( !user )
		return;
	
	let ass = self.worgs.getAssignedForUser( uid );
	if ( !ass || !ass.length )
		disconnect( uid );
	else
		showInWorkgroup( uid, ass[ 0 ]);
	
	function showInWorkgroup( uid, wg ) {
		const authed = {
			type : 'authed',
			data : {
				userId   : uid,
				worgId   : wg,
				authed   : user.authed,
			},
		};
		self.broadcast( authed );
	}
	
	function disconnect( uid ) {
		self.removeUser( uid );
	}
}

ns.Room.prototype.handleJoinLive = function( event, uid ) {
	const self = this;
	var user = self.users.get( uid );
	if ( !user ) {
		log( 'handleJoinLive - no user?', {
			id : uid,
			user : user,
			users : self.users.getList(),
		});
		return;
	}
	
	self.live.add( uid );
}

ns.Room.prototype.handleRestoreLive = function( event, uid ) {
	const self = this;
	self.live.restore( uid );
}

ns.Room.prototype.handleLeaveLive = function( event, uid ) {
	const self = this;
	self.live.remove( uid );
}

ns.Room.prototype.handleActive = function( event, userId ) {
	const self = this;
	if ( !event )
		return;
	
	self.setActive( event.isActive, userId );
}

ns.Room.prototype.setActive = function( isActive, userId ) {
	const self = this;
	self.users.setActive( isActive, userId );
}

// very private

ns.Room.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	self.users.broadcast( null, event, sourceId, wrapSource );
}

ns.Room.prototype.send = function( event, targetId ) {
	const self = this;
	self.users.send( targetId, event );
}

/* Room Settings */

const sLog = require( './Log' )( 'Room > Settings' );
ns.ConferenceSettings = function() {
	
}

module.exports = ns.Room;
