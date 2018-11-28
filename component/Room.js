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
	self.users = {};
	self.identities = {};
	self.onlineList = [];
	self.activeList = [];
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

// when users come online
ns.Room.prototype.connect = async function( userId ) {
	const self = this;
	if ( !self.users[ userId ])
		await self.addUser( userId );
	
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
	if ( self.checkIsAuthed( userId ))
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

// add to users so they appaear in users list for room in client
ns.Room.prototype.addUser = async function( userId ) {
	const self = this;
	// add to users
	if ( self.users[ userId ])
		return userId;
	
	let user = await self.idCache.get( userId );
	self.users[ userId ] = user;
	announce( user );
	return userId;
	
	function announce( user ) {
		// tell peoples
		const uId = user.clientId;
		const joinEvent = {
			type : 'join',
			data : {
				clientId   : uId,
				name       : user.name,
				avatar     : user.avatar,
				owner      : uId === self.ownerId,
				isAdmin    : user.isAdmin,
				isAuthed   : self.checkIsAuthed( uId ),
				isGuest    : user.isGuest,
				workgroups : self.worgs.getUserWorkgroupList( uId ),
			},
		};
		self.broadcast( joinEvent, uId );
	}
}

// remove a users access to this room, and disconnect them from it if
// they  are currently online. User is removed from users list in client
ns.Room.prototype.removeUser = async function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user ) {
		log( 'removeUser - invalid user', {
			aid : userId,
			usr : self.users,
		}, 3 );
		return false;
	}
	
	// unbind / set offline
	await self.releaseUser( userId );
	
	// remove
	if ( user.isGuest )
		self.removeIdentity( userId );
	
	delete self.users[ userId ];
	self.revokeAuthorization( userId );
	
	// tell everyone
	const leave = {
		type : 'leave',
		data : userId,
	};
	self.broadcast( leave, userId );
	if ( user.close )
		user.close();
	
	return true;
}

ns.Room.prototype.authenticateInvite = async function( token ) {
	const self = this;
	let valid = false;
	try {
		valid = await self.invite.authenticate( token );
	} catch ( e ) {
		log( 'authenticateInvite - failed', e );
	}
	return valid;
}

ns.Room.prototype.close = function( callback ) {
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
	
	self.emitterClose();
	
	delete self.live;
	delete self.invite;
	delete self.chat;
	delete self.log;
	delete self.worgs;
	delete self.settings;
	
	if ( self.onlineList )
		self.onlineList
			.forEach( uid => self.releaseUser( uid ));
	
	delete self.onlineList;
	delete self.activeList;
	delete self.authorized;
	delete self.users;
	
	delete self.idCache;
	delete self.dbPool;
	delete self.service;
	delete self.onempty;
	
	if ( callback )
		callback();
	
}

// Private

ns.Room.prototype.init = function( worgCtrl ) {
	const self = this;
	self.service = new FService( global.config.server.friendcore );
	self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
	
	self.settings = new components.Settings(
		self.dbPool,
		worgCtrl,
		self.id,
		self.users,
		self.onlineList,
		self.persistent,
		self.name,
		settingsDone
	);
	
	self.settings.on( 'roomName', roomName );
	function roomName( e ) { self.handleRename( e ); }
	
	async function settingsDone( err , res ) {
		self.worgs = new components.Workgroup(
			worgCtrl,
			self.dbPool,
			self.id,
			self.users,
			self.onlineList,
			self.settings,
		);
		self.worgs.on( 'remove-user', removeUser );
		self.worgs.on( 'dismissed', worgDismissed );
		self.worgs.on( 'assigned', worgAssigned );
		
		function removeUser( userId ){ self.removeUser( userId ); }
		function worgDismissed( e ) { self.handleWorkgroupDismissed( e ); }
		function worgAssigned( e ) { self.emit( 'workgroup-assigned', e ); }
		
		self.log = new components.Log(
			self.dbPool,
			self.id,
			self.users,
			self.idCache,
			self.persistent,
		);
		
		self.invite = new components.Invite(
			self.dbPool,
			self.id,
			self.users,
			self.onlineList,
			self.persistent
		);
		
		self.chat = new components.Chat(
			self.id,
			self.name,
			self.users,
			self.onlineList,
			self.log,
			self.service
		);
		
		self.live = new components.Live(
			self.users,
			self.onlineList,
			self.log,
			self.worgs,
			self.settings
		);
		
		if ( self.persistent )
			await self.loadUsers();
		
		self.setOpen();
	}
}

ns.Room.prototype.handleWorkgroupDismissed = function( worg ) {
	const self = this;
	self.emit( 'workgroup-dismissed', worg );
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
	self.userLoads = {};
	let auths = null;
	try {
		auths = await self.roomDb.loadAuthorizations( self.id );
	} catch( err ) {
		log( 'loadUsers - db fail', err );
		return false;
	}
	
	if ( !auths || !auths.length )
		return false;
	
	await Promise.all( auths.map( await add ));
	return true;
	
	async function add( dbUser ) {
		let cId = dbUser.clientId;
		self.authorized.push( cId );
		await self.addUser( cId );
	}
}

ns.Room.prototype.checkOnline = function() {
	const self = this;
	if ( 0 !== self.onlineList.length )
		return;
	
	if ( self.emptyTimer )
		return;
	
	self.emptyTimer = setTimeout( roomIsEmpty, self.emptyTimeout );
	function roomIsEmpty() {
		self.emptyTimer = null;
		if ( 0 !== self.onlineList.length )
			return; // someone joined during the timer. Lets not then, i guess
		
		self.emit( 'empty', Date.now());
		//self.onempty();
	}
}

// room events

ns.Room.prototype.bindUser = function( userId ) {
	const self = this;
	let user = self.users[ userId ];
	if ( !user ) {
		log( 'bindUSer - not a user in room', {
			roomId : self.id,
			userId : userId,
			users  : self.users,
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
			userId : userId,
			online  : self.onlineList,
		}, 4 );
		return user;
	}
	
	// removing basic user obj
	delete self.users[ userId ];
	const cId = user.clientId;
	
	// add signal user obj
	const sigConf = {
		roomId     : self.id,
		roomName   : self.name,
		isPrivate  : self.isPrivate,
		persistent : self.persistent,
		clientId   : cId,
		name       : user.name,
		fUsername  : user.fUsername,
		avatar     : user.avatar,
		isOwner    : cId === self.ownerId,
		isAdmin    : user.isAdmin,
		isAuthed   : self.checkIsAuthed( cId ),
		isGuest    : user.isGuest,
	};
	user = new Signal( sigConf );
	self.users[ userId ] = user;
	
	// bind room events
	user.on( 'initialize', init );
	user.on( 'persist', persist );
	user.on( 'identity', identity );
	user.on( 'disconnect', goOffline );
	user.on( 'leave', leaveRoom );
	user.on( 'live-join', joinLive );
	user.on( 'live-leave', leaveLive );
	user.on( 'active', active );
	
	let uid = userId;
	function init( e ) { self.initialize( e, uid ); }
	function persist( e ) { self.handlePersist( e, uid ); }
	function identity( e ) { self.setIdentity( e, uid ); }
	function goOffline( e ) { self.disconnect( uid ); }
	function leaveRoom( e ) { self.handleLeave( uid ); }
	function joinLive( e ) { self.handleJoinLive( e, uid ); }
	function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
	function active( e ) { self.handleActive( e, uid ); }
	
	// add to components
	self.invite.bind( userId );
	self.chat.bind( userId );
	self.settings.bind( userId );
	
	// show online
	self.setOnline( userId );
	return user;
	
}

ns.Room.prototype.checkIsAuthed = function( userId ) {
	const self = this;
	if ( !self.persistent )
		return true;
	
	return self.authorized.some( aId => aId === userId );
}

ns.Room.prototype.initialize = function( requestId, userId ) {
	const self = this;
	const state = {
		id          : self.id,
		name        : self.name,
		ownerId     : self.ownerId,
		persistent  : self.persistent,
		settings    : self.settings.get(),
		guestAvatar : self.guestAvatar,
		users       : buildBaseUsers(),
		online      : self.onlineList,
		identities  : self.identities,
		peers       : self.live.peerIds,
		workgroups  : self.worgs.get(),
		lastMessage : self.log.getLast( 1 )[ 0 ],
	};
	
	const init = {
		type : 'initialize',
		data : state,
	};
	
	self.send( init, userId );
	
	function buildBaseUsers() {
		const users = {};
		const uIds = Object.keys( self.users );
		uIds.forEach( build );
		return users;
		
		function build( uId ) {
			let user = self.users[ uId ];
			users[ uId ] = {
				clientId   : uId,
				name       : user.name,
				avatar     : user.avatar,
				isAdmin    : user.isAdmin,
				isAuthed   : self.checkIsAuthed( uId ),
				isGuest    : user.isGuest,
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
	self.name = event.name;
	self.persistRoom( persistBack );
	function persistBack( res ) {
		if ( !res )
			return;
		
		self.settings.setPersistent( true, self.name );
		self.log.setPersistent( true );
		self.invite.setPersistent( true );
		self.onlineList.forEach( update );
		function update( userId ) {
			const user = self.users[ userId ];
			if ( !user || !user.setRoomPersistent )
				return;
			
			user.setRoomPersistent( true, event.name );
		}
	}
}

ns.Room.prototype.persistRoom = function( callback ) {
	const self = this;
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
		const userIds = Object.keys( self.users );
		const accIds = userIds.filter( notGuest );
		self.authorized = accIds;
		self.authorized.forEach( updateClients );
		self.roomDb.authorize( self.id, accIds )
			.then( authSet )
			.catch( err );
	}
	
	function notGuest( uid ) {
		const user = self.users[ uid ];
		return !user.isGuest;
	}
	
	function authSet( ok ) {
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
	const accIds = [ userId ];
	const success = await self.roomDb.authorize( self.id, accIds );
	if ( !success )
		return false;
	
	self.authorized.push( userId );
}

ns.Room.prototype.revokeAuthorization = function( userId, callback ) {
	const self = this;
	self.roomDb.revoke( self.id, userId )
	.then( revokeDone )
	.catch( revokeFailed );
	
	function revokeDone( res ) {
		self.authorized = self.authorized.filter( uid => userId !== uid );
		done( null, res );
	}
	
	function revokeFailed( err ) {
		log( 'revokeAuthorization - err', err.stack || err );
		done( err, null );
	}
	
	function done( err, res ) {
		if ( callback )
			callback( err, userId );
	}
}

// tell the user / client, it has been authorized for this room
ns.Room.prototype.updateUserAuthorized = function( isAuthed, userId ) {
	const self = this;
	const user = self.users[ userId ];
	user.setIsAuthed( isAuthed );
}

ns.Room.prototype.handleRename = function( name, userId ) {
	const self = this;
	self.name = name;
	self.onlineList.forEach( uId => {
		let user = self.users[ uId ];
		if ( !user.roomName )
			return;
		
		user.roomName = name;
	});
}

ns.Room.prototype.setIdentity = function( id, userId ) {
	const self = this;
	if ( id.clientId !== userId ) {
		log( 'setIdentity - clientId does not match userId', {
			id     : id,
			userId : userId,
		});
		return;
	}
	const user = self.users[ userId ];
	if ( user && user.isGuest )
		user.name = id.name;
	
	self.identities[ userId ] = id;
	const uptd = {
		type : 'identity',
		data : {
			userId   : userId,
			identity : id,
		},
	};
	self.broadcast( uptd );
}

ns.Room.prototype.removeIdentity = function( userId ) {
	const self = this;
	delete self.identities[ userId ];
	// TODO, tell clientS? eh.. v0v
}

// cleans up a users signal connection to this room
ns.Room.prototype.releaseUser = async function( userId ) {
	const self = this;
	let user = self.users[ userId ];
	if ( !user ) {
		log( 'releaseUser - no user', {
			u : userId,
			users : Object.keys( self.users ),
		}, 3 );
		return;
	}
	
	if ( !user.close ) // not signal, so not bound
		return;
	
	self.live.remove( userId );
	self.setOffline( userId );
	const id = await self.idCache.get( userId );
	delete self.users[ userId ];
	self.users[ userId ] = id;
	// no need to release each event, .release() is magic
	user.release();
	user.close();
	self.checkOnline();
}

ns.Room.prototype.setOnline = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return null;
	
	self.onlineList.push( userId );
	const online = {
		type : 'online',
		data : {
			clientId   : userId,
			isAdmin    : user.isAdmin || false,
			isAuthed   : user.isAuthed || false,
			workgroups : self.worgs.getUserWorkgroupList( userId ),
		}
	};
	self.broadcast( online );
	return user;
}

ns.Room.prototype.setOffline = async function( userId ) {
	const self = this;
	const userIndex = self.onlineList.indexOf( userId );
	if ( -1 !== userIndex ) {
		let removed = self.onlineList.splice( userIndex, 1 );
	}
	
	const offline = {
		type : 'offline',
		data : userId,
	};
	self.broadcast( offline );
}

// peer things

ns.Room.prototype.handleLeave = function( uid ) {
	const self = this;
	// check if user is authorized, if so, remove
	self.roomDb.check( uid )
		.then( authBack )
		.catch( leaveErr );
		
	function authBack( isAuthorized ) {
		if ( isAuthorized )
			self.revokeAuthorization( uid, revokeBack );
		else {
			const user = self.users[ uid ];
			user.authed = false;
			checkHasWorkgroup( uid );
		}
	}
	
	function revokeBack( err, revokeUid ) {
		if ( err ) {
			leaveErr( err );
			return;
		}
		
		checkHasWorkgroup( uid );
	}
	
	function checkHasWorkgroup( uid ) {
		// check if user is in a workgroup assigned to this room
		// if so, dont close connection and move user to workgroup ( in ui )
		// else close
		const user = self.users[ uid ];
		if ( !user )
			return;
		
		let ass = self.worgs.getAssignedForUser( uid );
		if ( !ass || !ass.length )
			disconnect( uid );
		else
			showInWorkgroup( uid, ass[ 0 ]);
	}
	
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
	
	function leaveErr( err ) {
		log( 'handleLeave auth check err', err );
		self.removeUser( uid );
	}
}

ns.Room.prototype.handleJoinLive = function( event, uid ) {
	const self = this;
	var user = self.users[ uid ];
	if ( !user ) {
		log( 'handleJoinLive - no user?', {
			id : uid,
			user : user,
			users : self.users,
		});
		return;
	}
	
	self.live.add( uid );
}

ns.Room.prototype.handleLeaveLive = function( event, uid ) {
	const self = this;
	self.live.remove( uid );
}

ns.Room.prototype.handleActive = function( event, userId ) {
    const self = this;
}

// very private

ns.Room.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( wrapSource )
		event = {
			type : sourceId,
			data : event,
		};
	
	self.onlineList.forEach( sendTo );
	function sendTo( uid ) {
		if ( sourceId && uid === sourceId )
			return;
		
		self.send( event, uid );
	}
}

ns.Room.prototype.send = function( event, targetId ) {
	const self = this;
	if ( !event )
		throw new Error( 'Room.send - no event' );
	
	var user = self.users[ targetId ];
	if ( !user || !user.send )
		return;
	
	user.send( event );
}

/* Room Settings */

const sLog = require( './Log' )( 'Room > Settings' );
ns.ConferenceSettings = function() {
	
}

module.exports = ns.Room;
