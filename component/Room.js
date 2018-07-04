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
const Signal = require( './Signal' );
const dFace = require( './DFace' );
const Janus = require( './Janus' );
const util = require( 'util' );

var ns = {};

/* Send
	Default implementation of 
		.send()
		.broadcast()
	
*/
ns.UserSend = function( type, users, onlineList ) {
	const self = this;
	self.type = type;
	self.users = users;
	self.onlineList = onlineList;
	
	self.sendInit();
}

// 'Public'

ns.UserSend.prototype.send = function( event, userId, callback ) {
	const self = this;
	if ( !self.users ) {
		error( 'ERR_SEND_NO_USERS_OBJ' );
		return;
	}
	
	const user = self.users[ userId ];
	if ( !user ) {
		self.sendLog( 'no such user', userId );
		error( 'ERR_SEND_NO_USER');
		return;
	}
	
	if ( !user.send ) {
		self.sendLog( 'user has no .send() - not online', user, 3 );
		error( 'ERR_SEND_NOT_ONLINE' );
		return;
	}
	
	if ( self.type )
		event = {
			type : self.type,
			data : event,
		};
	
	user.send( event, callback );
	
	function error( err ) {
		if ( callback )
			callback( err );
	}
}

ns.UserSend.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( !self.onlineList )
		return;
	
	if ( wrapSource )
		event = {
			type : sourceId,
			data : event,
		};
	
	self.onlineList.forEach( sendIfNotSource );
	function sendIfNotSource( userId ) {
		if ( userId === sourceId )
			return;
		
		self.send( event, userId );
	}
}

ns.UserSend.prototype.close = function() {
	const self = this;
	delete self.onlineList;
	delete self.users;
	delete self.type;
}

// priv

ns.UserSend.prototype.sendInit = function() {
	const self = this;
	self.sendLog = require( './Log' )( 'Room > ' + self.type );
}


/* Room


*/
ns.Room = function( conf, db, idCache ) {
	const self = this;
	if ( !conf.clientId )
		throw new Error( 'Room - clientId missing' );
	
	self.id = conf.clientId;
	self.ownerId = conf.ownerId;
	self.name = conf.name || null;
	self.persistent = conf.persistent || false;
	self.guestAvatar = conf.guestAvatar;
	self.dbPool = db;
	self.idCache = idCache;
	
	self.open = false;
	self.invite = null;
	self.chat = null;
	self.live = null;
	self.users = {};
	self.identities = {};
	self.onlineList = [];
	self.authorized = [];
	self.accessKey = null;
	self.roomDb = null;
	self.emptyTimeout = 1000 * 20;
	self.emptyTimer = null;
	
	Emitter.call( self );
	
	self.init();
}

util.inherits( ns.Room, Emitter );

// Public

// when users come online
ns.Room.prototype.connect = function( account ) {
	const self = this;
	self.processWorkgroups( account );
	const signal = self.bindUser( account );
	if ( self.emptyTimer ) {
		clearTimeout( self.emptyTimer );
		self.emptyTimer = null;
	}
	
	return signal;
}

// when user goes offline
ns.Room.prototype.disconnect = function( accountId ) {
	const self = this;
	if ( isAuthorized( accountId ))
		self.releaseUser( accountId );
	else
		self.removeUser( accountId );
	
	function isAuthorized( accId ) {
		return self.authorized.some( authId => authId === accId );
	}
}

// for real accounts, not for guests
// authorizes an account to connect to this room
ns.Room.prototype.authorizeUser = function( user, callback ) {
	const self = this;
	let uid = user.accountId;
	self.persistAuthorization( uid );
	if ( callback )
		callback( null, uid );
}

// add to users list, they can now .connect()
ns.Room.prototype.addUser = function( user, callback ) {
	const self = this;
	// add to users
	const uid = user.accountId;
	if ( self.users[ uid ]) {
		callback( null, uid );
		return;
	}
	
	if ( !self.isPersistent && !user.guest )
		user.authed = true;
	
	self.processWorkgroups( user );
	self.users[ uid ] = user;
	
	if ( !user.avatar && !user.guest ) {
		self.idCache.get( uid )
			.then( id => {
				setAvatar( id.avatar );
			}).catch( err => {
				setAvatar( '' );
			});
	} else
		announceUser( user );
	
	function setAvatar( pngStr ) {
		user.avatar = pngStr;
		announceUser( user );
	}
	
	function announceUser( user ) {
		// tell peoples
		var joinEvent = {
			type : 'join',
			data : {
				clientId   : user.accountId,
				name       : user.accountName,
				avatar     : user.avatar,
				owner      : user.accountId === self.ownerId,
				admin      : user.admin || undefined,
				authed     : user.authed || undefined,
				guest      : user.guest || undefined,
				workgroups : user.workgroups || undefined,
			},
		};
		self.broadcast( joinEvent, uid );
		callback( null, uid );
	}
}

// 
ns.Room.prototype.removeUser = function( accountId ) {
	const self = this;
	const user = self.users[ accountId ];
	if ( !user ) {
		log( 'removeUser - invalid user', {
			aid : accountId,
			usr : self.users,
		}, 3 );
		return false;
	}
	
	// unbind / set offline
	self.releaseUser( accountId );
	
	// remove
	if ( user.guest )
		self.removeIdentity( accountId );
	
	delete self.users[ accountId ];
	self.revokeAuthorization( accountId );
	
	// tell everyone
	const leave = {
		type : 'leave',
		data : accountId,
	};
	self.broadcast( leave, accountId );
	if ( user.close )
		user.close();
	
	return true;
}

ns.Room.prototype.authenticateInvite = async function( token ) {
	const self = this;
	const valid = await self.invite.authenticate( token );
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
	
	self.onlineList.forEach( release );
	delete self.onlineList;
	delete self.authorized;
	delete self.users;
	
	delete self.idCache;
	delete self.dbPool;
	delete self.onempty;
	
	if ( callback )
		callback();
	
	function release( uid ) { self.releaseUser( uid ); }
}

// Private

ns.Room.prototype.init = function() {
	const self = this;
	self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
	
	self.settings = new ns.Settings(
		self.dbPool,
		self.id,
		self.users,
		self.onlineList,
		self.persistent,
		self.name,
		settingsDone
	);
	
	self.settings.on( 'roomName', roomName );
	function roomName( e ) { self.handleRename( e ); }
	
	function settingsDone( err , res ) {
		self.worgs = new ns.Workgroup(
			self.dbPool,
			self.id,
			self.users,
			self.onlineList,
			self.settings,
			removeUser
		);
		self.worgs.on( 'dismissed', worgDismissed );
		self.worgs.on( 'assigned', worgAssigned );
		
		// for when a workgroup is dismissed, refactor to use dismissed event
		function removeUser( userId ){ self.removeUser( userId ); }
		function worgDismissed( e ) { self.handleWorkgroupDismissed( e ); }
		function worgAssigned( e ) { self.emit( 'workgroup-assigned', e ); }
		
		self.log = new ns.Log(
			self.dbPool,
			self.id,
			self.users,
			self.idCache,
			self.persistent,
		);
		
		self.invite = new ns.Invite(
			self.dbPool,
			self.id,
			self.users,
			self.onlineList,
			self.persistent
		);
		
		self.chat = new ns.Chat(
			self.id,
			self.users,
			self.onlineList,
			self.log
		);
		
		self.live = new ns.Live(
			self.users,
			self.onlineList,
			self.log,
			self.worgs,
			self.settings
		);
		
		if ( self.persistent )
			self.loadUsers();
		else
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

ns.Room.prototype.loadUsers = function() {
	const self = this;
	self.userLoads = {};
	self.roomDb.loadAuthorizations( self.id )
		.then( authBack )
		.catch( loadFailed );
	
	function authBack( rows ) {
		if ( !rows || !rows.length )
			self.setOpen();
		else
			addUsers( rows );
	}
	
	function loadFailed( err ) {
		log( 'loadAuthorizations - load failed', {
			e : err,
			s : err.stack,
		});
	}
	
	function addUsers( users ) {
		const tinyAvatar = require( './TinyAvatar' );
		users.forEach( add );
		
		function add( dbUser, index ) {
			const uid = dbUser.clientId;
			self.authorized.push( uid );
			self.userLoads[ uid ] = true;
			if ( self.users[ uid ])
				return;
			
			if ( !dbUser.avatar )
				self.idCache.get( uid )
					.then( id => {
						setUser( id.avatar );
					}).catch( err => setUser( null ));
			else
				setUser( dbUser.avatar );
			
			function setUser( avatar ) {
				avatar = avatar || '';
				const user = {
					accountId   : uid,
					accountName : dbUser.name,
					avatar      : avatar,
					authed      : true,
				};
				
				self.users[ uid ] = user;
				isLoaded( uid );
			}
		}
	}
	
	function isLoaded( uid ) {
		self.userLoads[ uid ] = false;
		const ids = Object.keys( self.userLoads );
		const allDone = ids.every( id => !self.userLoads[ id ] )
		if ( !allDone )
			return;
		
		self.setOpen();
	}
}

ns.Room.prototype.processWorkgroups = function( user ) {
	const self = this;
	if ( !user.workgroups || !user.workgroups.member )
		return;
	
	const wgs = user.workgroups;
	self.worgs.add( wgs.available || wgs.member );
	if ( wgs.stream )
		self.worgs.addStream( wgs.stream );
	
	user.workgroups = wgs.member.map( wg => wg.clientId );
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

ns.Room.prototype.bindUser = function( account ) {
	const self = this;
	const userId = account.clientId;
	const conf = self.users[ userId ];
	if ( !conf ) {
		log( 'bindUSer - no user for id', {
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
	
	if ( conf.close ) {
		log( 'bindUser - user already bound', {
			userId : userId,
			online  : self.onlineList,
		}, 4 );
		return conf;
	}
	
	// removing basic user obj
	delete self.users[ userId ];
	
	// add signal user obj
	const sigConf = {
		roomId      : self.id,
		roomName    : self.name,
		persistent  : self.persistent,
		accountId   : conf.accountId,
		accountName : conf.accountName,
		avatar      : conf.avatar,
		owner       : conf.accountId === self.ownerId,
		admin       : account.admin, // <-- using account
		authed      : account.authed || conf.authed || false,
		guest       : conf.guest,
		workgroups  : account.workgroups || conf.workgroups || [],
	};
	const user = new Signal( sigConf );
	self.users[ userId ] = user;
	
	// bind room events
	user.on( 'initialize', init );
	user.on( 'persist', persist );
	user.on( 'identity', identity );
	user.on( 'disconnect', goOffline );
	user.on( 'leave', leaveRoom );
	user.on( 'live-join', joinLive );
	user.on( 'live-leave', leaveLive );
	
	let uid = userId;
	function init( e ) { self.initialize( e, uid ); }
	function persist( e ) { self.handlePersist( e, uid ); }
	function identity( e ) { self.setIdentity( e, uid ); }
	function goOffline( e ) { self.disconnect( uid ); }
	function leaveRoom( e ) { self.handleLeave( uid ); }
	function joinLive( e ) { self.handleJoinLive( e, uid ); }
	function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
	
	// add to components
	self.invite.bind( userId );
	self.chat.bind( userId );
	self.settings.bind( userId );
	
	// show online
	self.setOnline( userId );
	return user;
}

ns.Room.prototype.initialize =  function( requestId, userId ) {
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
		workgroups  : self.worgs.getAssigned(),
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
		
		function build( uid ) {
			const user = self.users[ uid ];
			if ( !user )
				return undefined;
			
			let aId = user.accountId;
			users[ aId ] = {
				clientId   : aId,
				name       : user.accountName,
				avatar     : user.avatar,
				admin      : user.admin,
				authed     : user.authed,
				guest      : user.guest,
				workgroups : user.workgroups,
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
		return !user.guest;
	}
	
	function authSet( res ) {
		callback( true );
	}
	
	function err( err ) {
		log( 'persistRoom err', err );
		callback( null );
	}
	
	function updateClients( userId ) {
		self.updateUserAuthorized( true, userId );
	}
}

ns.Room.prototype.persistAuthorization = function( userId ) {
	const self = this;
	const accIds = [ userId ];
	self.roomDb.authorize( self.id, accIds )
		.then( authorized )
		.catch( authFailed );
		
	function authorized( res ) {
		self.authorized.push( userId );
	}
	
	function authFailed( err ) {
		log( 'persistAuthorization - authFailed', err.stack || err );
	}
}

ns.Room.prototype.revokeAuthorization = function( userId, callback ) {
	const self = this;
	self.roomDb.revoke( self.id, userId )
	.then( revokeDone )
	.catch( revokeFailed );
	
	function revokeDone( res ) {
		self.authorized = self.authorized.filter( uid => userId !== uid );
		if ( callback )
			callback( null, userId );
	}
	
	function revokeFailed( err ) {
		log( 'revokeAuthorization - err', err.stack || err );
		if ( callback )
			callback( err, null );
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
	if ( user && user.guest )
		user.accountName = id.name;
	
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
ns.Room.prototype.releaseUser = function( userId ) {
	const self = this;
	var user = self.users[ userId ];
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
			admin      : user.admin || false,
			authed     : user.authed || false,
			workgroups : user.workgroups || [],
		}
	};
	self.broadcast( online );
	return user;
}

ns.Room.prototype.setOffline = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	
	// deleteing signal
	delete self.users[ userId ];
	// adding basic obj
	self.users[ userId ] = {
		accountId    : user.accountId,
		accountName  : user.accountName,
		avatar       : user.avatar,
		admin        : user.admin,
		authed       : user.authed,
		guest        : user.guest,
		workgroups   : user.workgroups,
	};
	
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
		else
			checkHasWorkgroup( uid );
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
		user.authed = false;
		if ( !user )
			return;
		
		let wgs = user.workgroups;
		if ( !wgs || !wgs.length ) {
			disconnect( uid );
			return;
		}
		
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

// CHAT

const cLog = require( './Log' )( 'Room > Chat' );
ns.Chat = function(
	roomId,
	users,
	onlineList,
	log
) {
	const self = this;
	self.roomId = roomId;
	self.users = users;
	self.onlineList = onlineList;
	self.log = log;
	
	self.init();
}

// Public

ns.Chat.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user || !user.on ) // no .on() means its an offline user
		return;
	
	user.on( 'chat', cat );
	function cat( e ) { self.handleChat( e, userId ); }
}

ns.Chat.prototype.close = function( callback ) {
	const self = this;
	delete self.roomId;
	delete self.users;
	delete self.onlineList;
	delete self.log;
	
	if ( callback )
		callback();
}

// Private

ns.Chat.prototype.init = function() {
	const self = this;
	self.eventMap = {
		'msg'   : msg,
		'log'   : log,
		'state' : state,
	};
	
	function msg( e, uid ) { self.handleMsg( e, uid ); }
	function log( e, uid ) { self.handleLog( e, uid ); }
	function state( e, uid ) { self.handleState( e, uid ); }
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

ns.Chat.prototype.handleMsg = function( data, userId ) {
	const self = this;
	const user = self.users[ userId ];
	const fromId = user.guest ? null : userId;
	const message = data.message;
	const mid = uuid.get( 'msg' );
	const msg = {
		msgId   : mid,
		roomId  : self.roomId,
		fromId  : fromId,
		name    : user.accountName,
		time    : Date.now(),
		type    : 'msg',
		message : message,
	};
	
	const event = {
		type : 'msg',
		data : msg,
	};
	
	self.log.add( event );
	self.broadcast( event );
}

ns.Chat.prototype.handleLog = function( event, userId ) {
	const self = this;
	self.log.get( event )
		.then( loaded )
		.catch( logErr );
		
	function loaded( items ) {
		const log = {
			type : 'log',
			data : items,
		};
		
		self.send( log, userId );
	}
	
	function logErr( err ) {
		cLog( 'handleLog - log load err', err.stack || err );
	}
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

ns.Chat.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
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
}

ns.Chat.prototype.relay = function( event, targetId, sourceId ) {
	const self = this;
	cLog( 'relay wahtnow?', {
		e : event,
		t : targetId,
		s : sourceId,
	});
}

ns.Chat.prototype.send = function( event, userId ) {
	const self = this;
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
}


// LIVE - collection of users in a live session

var lLog = require( './Log' )( 'Room > Live' );
ns.Live = function(
	users,
	onlineList,
	log,
	workgroups,
	settings,
) {
	const self = this;
	self.users = users;
	self.onlineList = onlineList;
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

ns.Live.prototype.add = function( userId ) { //adds user to existing room
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return;
	
	const pid = user.accountId;
	if ( self.peers[ pid ]) {
		self.reAdd( pid );
		return;
	}
	
	if ( self.isStream ) {
		if ( null == self.proxy ) {
			self.setupStreamProxy();
		}
		
		if ( !self.sourceId ) {
			let isStreamer = self.worgs.isStreamer( user.workgroups );
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

ns.Live.prototype.remove = function( peerId ) { // userId
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
		if ( self.proxy.remove_user( peerId ) == false ) { //room is empty
			self.closeStreamProxy();
		}
	}
	
	const peer = self.getPeer( peerId );
	if ( !peer )
		return;
	
	self.stopPing( peerId );
	// tell the peer
	self.sendClose( peerId, peer.liveId );
	peer.liveId = null;
	// tell everyone else
	self.sendLeave( peerId );
	// remove & release
	delete self.peers[ peerId ];
	self.peerIds = Object.keys( self.peers );
	peer.release( 'live' );
	self.updateQualityScale();
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
	delete self.onlineList;
	delete self.log;
	delete self.workgroups;
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

ns.Live.prototype.reAdd = function( pid ) {
	const self = this;
	if ( self.peerAddTimeouts[ pid ]){
		return; // already being re added
	}
	
	const peer = self.peers[ pid ];
	self.stopPing( pid );
	self.sendClose( pid, peer.liveId );
	peer.liveId = null;
	self.sendLeave( pid );
	delete self.peers[ pid ];
	self.peerIds = Object.keys( self.peers );
	peer.release( 'live' );
	self.peerAddTimeouts[ pid ] = setTimeout( add, 100 );
	function add() {
		delete self.peerAddTimeouts[ pid ];
		self.add( pid );
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
	var peer = self.peers[ peerId ] || self.users[ peerId ] || null;
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
}

ns.Live.prototype.broadcastOnline = function( data, sourceId, wrapSource ) {
	const self = this;
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
}

ns.Live.prototype.send = function( event, targetId, callback ) {
	const self = this;
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
	self.onlineList = online;
	self.isPersistent = isPersistent;
	
	self.publicToken = null;
	self.tokens = {};
	
	self.eventMap = null;
	
	self.init( dbPool, roomId );
}

// Public

ns.Invite.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return;
	
	user.on( 'invite', invite );
	function invite( e ) { self.handle( e, userId ); }
}

ns.Invite.prototype.release = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
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
	delete self.onlineList;
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
	iLog( 'getInviteHost', global.config.shared.wsHost );
	return global.config.shared.wsHost;
}

ns.Invite.prototype.broadcast = function( event, sourceId ) {
	const self = this;
	self.onlineList
		.forEach( sendTo );
		
	function sendTo( uid ) {
		if ( uid === sourceId )
			return;
		
		self.send( event, uid );
	}
}

ns.Invite.prototype.send = function( event, targetId ) {
	const self = this;
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

// Public

ns.Log.prototype.add = function( msg ) {
	const self = this;
	self.items.push( msg );
	if ( 100 < self.items.length )
		self.items = self.items.slice( -50 );
	
	if ( self.persistent )
		self.persist( msg );
	
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

ns.Log.prototype.getLast = function( length ) {
	const self = this;
	return self.items.slice( -length );
}

ns.Log.prototype.setPersistent = function( isPersistent ) {
	const self = this;
	if ( self.persistent )
		return;
	
	self.persistent = isPersistent;
	self.writeLogToDb();
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
	self.load()
		.then( logBack )
		.catch( logErr );
		
	function logBack( log ) {
		self.items = log.data.events;
		self.ids = log.data.ids;
	}
	
	function logErr( err ) {
		llLog( 'init load err', err.stack || err );
	}
}

ns.Log.prototype.load = function( conf ) {
	const self = this;
	if ( !conf ) {
		conf = {};
		return new Promise( loadBefore );
	}
	
	if ( conf.lastId )
		return new Promise( loadAfter );
	else
		return new Promise( loadBefore );
	
	function loadBefore( resolve, reject ) {
		self.msgDb.getBefore( conf.firstId, conf.length )
			.then( loaded )
			.catch( loadErr );
			
		function loaded( items ) {
			buildLogEvent( 'before', items )
				.then( resolve )
				.catch( err => llLog( 'loadBefore - err', err ));
		}
		
		function loadErr( e ) {
			llLog( 'loadErr', e );
			reject( e );
		}
	}
	
	function loadAfter( resolve, reject ) {
		self.msgDb.getAfter( conf.lastId, conf.length )
			.then( loaded )
			.catch( loadErr );
			
		function loaded( items ) {
			buildLogEvent( 'after', items )
				.then( resolve )
				.catch( err => llLog( 'loadAfter - err', err ));
		}
		
		function loadErr( e ) {
			llLog( 'loadErr', e );
			reject( e );
		}
	}
	
	async function buildLogEvent( type, dbEvents ) {
		let events = parse( dbEvents );
		let unknownIds = await getUnknownIdentities( events );
		let log = {
			type : type,
			data : {
				events : events,
				ids    : unknownIds,
			},
		};
		return log;
		
		function parse( items ) {
			if ( !items )
				return null;
			
			const events = items.map( extractType );
			return events;
			
			function extractType( item ) {
				const event = {
					type : item.type,
					data : null,
				};
				delete item.type;
				event.data = item;
				return event;
			}
		}
		
		async function getUnknownIdentities( events ) {
			if ( !events || !events.length )
				return null;
			
			let unknownIds = {};
			for ( let event of events ) {
				let uId = event.data.fromId;
				if ( !uId )
					continue;
				
				if ( unknownIds[ uId ])
					continue;
				
				let user = self.users[ uId ]
				if ( user )
					continue;
				
				let id = await self.idCache.get( uId );
				unknownIds[ uId ] = id;
			};
			
			return unknownIds;
		}
	}
}

ns.Log.prototype.persist = function( event ) {
	const self = this;
	let item = event.data;
	item.type = event.type;
	
	self.msgDb.set( item )
		.then( ok )
		.catch( err );
		
		function ok( res ) {}
		
		function err( err ) {
			llLog( 'write err', err.stack || err );
		}
}

ns.Log.prototype.writeLogToDb = function() {
	const self = this;
	self.items.forEach( store );
	function store( item ) {
		self.persist( item );
	}
}


// Workgroup - always connected to a Room

let wLog = require( './Log' )( 'Room > Workgroup' );
ns.Workgroup = function(
	dbPool,
	roomId,
	users,
	onlineList,
	settings,
	removeUser
 ) {
	const self = this;
	Emitter.call( self );
	
	self.roomId = roomId;
	self.users = users;
	self.onlineList = onlineList;
	self.settings = settings;
	
	self.db = null;
	self.groups = {};
	self.ids = [];
	self.list = [];
	self.assigned = {};
	self.stream = [];
	self.streamIds = [];
	self.removeUser = removeUser; // callback to remove user from Room
	
	self.init( dbPool );
}

util.inherits( ns.Workgroup, Emitter );

// 

ns.Workgroup.prototype.add = function( wgs ) {
	const self = this;
	if ( !wgs || !wgs.length )
		return;
	
	let added = wgs
		.map( add )
		.filter( notNull );
	
	if ( added.length )
		updateData();
	
	self.updateSettings();
	return added;
	
	function add( wg ) {
		if ( self.groups[ wg.clientId ] )
			return null;
		
		self.groups[ wg.clientId ] = wg;
		return wg;
	}
	
	function notNull( wg ) {
		return !!wg;
	}
	
	function updateData() {
		self.ids = Object.keys( self.groups );
		self.list = self.ids.map( wgId  => self.groups[ wgId ]);
		self.updateClients();
	}
}

ns.Workgroup.prototype.addStream = function( streamWgs ) {
	const self = this;
	streamWgs = streamWgs.filter( newWg => {
		return !self.stream.some( currentWg => newWg === currentWg );
	});
	if ( !streamWgs.length )
		return;
	
	self.stream = streamWgs;
	self.streamIds = self.list.filter( wg => {
		let wgName = wg.name;
		return streamWgs.some( streamWgName => streamWgName === wgName );
	}).map( wg => wg.clientId );
}

ns.Workgroup.prototype.isStreamer = function( userWgs ) {
	const self = this;
	let isStreamer = userWgs.some( uwgId => {
		return self.streamIds.some( sId => uwgId === sId );
	});
	
	return isStreamer;
}

ns.Workgroup.prototype.getAvailable = function() {
	const self = this;
	return self.list;
}

ns.Workgroup.prototype.getAssigned = function() {
	const self = this;
	return self.list
		.filter( isAssigned )
		.map( addInfo );
		
	function isAssigned( wg ) {
		return !!self.assigned[ wg.fId ];
	}
	
	function addInfo( wg ) {
		let ass = self.assigned[ wg.fId ];
		wg.setById = ass.setById;
		wg.setTime = ass.setTime;
		return wg;
	}
}

ns.Workgroup.prototype.getAssignedClientIds = function() {
	const self = this;
	const assigned = self.getAssigned();
	return assigned.map( item => item.clientId );
}

ns.Workgroup.prototype.getAssignedForUser = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user ) {
		wLog( 'getAssignedfor - user', user );
		return null;
	}
	
	const uwgs = user.workgroups;
	if ( !uwgs || !uwgs.length )
		return [];
	
	const ass = self.getAssignedClientIds();
	const userAss = ass.filter( userIsMember );
	
	return userAss;
	
	function userIsMember( aId ) {
		return !!uwgs.some( cId => aId === cId );
	}
}

// Update assigned workgroups on room (item)
ns.Workgroup.prototype.updateAssigned = function( item, userId ) {
	const self = this;
	let err = getValid( item );
	if ( err ) {
		sendErr( item, userId );
		return;
	}
	
	const cId = item.clientId;
	const worg = self.groups[ cId ];
	const fId = worg.fId;
	if ( true === item.value )
		assign();
	else
		dismiss();
	
	self.updateSettings();
	
	// Assign workgroup to room
	function assign() {
		if ( self.assigned[ fId ]) {
			sendOk( item, userId );
			return;
		}
		
		self.db.assignWorkgroup( fId, userId )
			.then( assigned )
			.catch( dbErr );
		
		function assigned( dbWorg ) {
			self.addAssigned( dbWorg );
			self.emit( 'assigned', {
				fId : fId,
				cId : cId,
			});
			sendOk( item, userId );
		}
	}
	
	// Remove workgroup from room
	function dismiss() {
		wLog( 'dismiss', [
			self.assigned,
			fId
		], 3 );
		if ( !self.assigned[ fId ]) {
			//resolve( fId );
			return;
		}
		
		self.db.dismissWorkgroup( fId )
			.then( dismissed )
			.catch( dbErr );
		
		function dismissed( res ) {
			self.removeDismissed( fId );
			self.removeUsers();
			self.emit( 'dismissed', {
				fId : fId,
				cId : cId,
			});
			sendOk( item, userId );
		}
	}
	
	function getValid( item ) {
		if ( !item || !item.clientId )
			return 'ERR_NO_CLIENTID';
		
		const group = self.groups[ item.clientId ];
		if ( !group )
			return 'ERR_NO_GROUP';
		
		return null;
	}
	
	function dbErr( err ) {
		wLog( 'dbErr', err );
	}
	
	function sendOk( item, userId ) {
		self.settings.sendSaved( 'workgroups', item, true, userId );
	}
	
	function sendErr( item, err, userId ) {
		self.settings.sendError( 'workgroups', err, userId );
	}
}

ns.Workgroup.prototype.send = function( event, userId, callback ) {
	const self = this;
	if ( !self.conn ) {
		callback( 'ERR_NO_CONN', null );
		return;
	}
	
	self.conn.send( event, userId, callback );
}

ns.Workgroup.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( !self.conn )
		return;
	
	self.conn.broadcast( event, sourceId, wrapSource );
}

ns.Workgroup.prototype.close = function() {
	const self = this;
	self.emitterClose();
	
	if ( self.conn )
		self.conn.close();
	
	if ( self.db )
		self.db.close();
	
	delete self.roomId;
	delete self.conn;
	delete self.db;
	delete self.users;
	delete self.onlineList;
	delete self.settings;
	delete self.groups;
	delete self.ids;
	delete self.list;
	delete self.stream;
	delete self.streamIds;
	delete self.removeUser;
}

// private

ns.Workgroup.prototype.init = function( dbPool ) {
	const self = this;
	self.conn = new ns.UserSend( 'workgroup', self.users, self.onlineList );
	self.db = new dFace.RoomDB( dbPool, self.roomId );
	self.db.getAssignedWorkgroups()
		.then( wgs )
		.catch( loadErr );
	
	function wgs( res ) {
		self.setAssigned( res );
		self.updateSettings();
	};
	
	function loadErr( err ) {
		wLog( 'failed to load workgroups from DB', err );
	}
	
	self.settings.on( 'workgroups', handleWorgUpdate );
	function handleWorgUpdate( item, userId ) {
		self.updateAssigned( item, userId );
	}
}

ns.Workgroup.prototype.setAssigned = function( dbWorgs ) {
	const self = this;
	dbWorgs.forEach( add );
	function add( wg ) {
		self.assigned[ wg.fId ] = wg;
	}
}

ns.Workgroup.prototype.updateSettings = function() {
	const self = this;
	let available = self.getAvailable();
	let assigned = self.getAssignedClientIds();
	self.settings.updateWorkgroups( available, assigned );
}

ns.Workgroup.prototype.updateClients = function() {
	const self = this;
	const worgs = {
		type : 'list',
		data : self.list,
	};
	self.broadcast( worgs );
}

ns.Workgroup.prototype.addAssigned = function( dbWorg ) {
	const self = this;
	self.assigned[ dbWorg.fId ] = dbWorg;
	const update = {
		type : 'assigned',
		data : self.getAssigned(),
	};
	self.broadcast( update );
}

ns.Workgroup.prototype.removeDismissed = function( fId ) {
	const self = this;
	delete self.assigned[ fId ];
}

ns.Workgroup.prototype.removeUsers = function() {
	const self = this;
	let toBeRemoved = self.onlineList.filter( checkHasAssigned );
	toBeRemoved.forEach( uid => self.removeUser( uid ));
	function checkHasAssigned( userId ) {
		let user = self.users[ userId ];
		if ( user.authed )
			return false;
		
		let assForUser = self.getAssignedForUser( userId );
		return !assForUser.length;
	}
}


// Settings

const sLog = require( './Log' )( 'Room > Settings' );
ns.Settings = function(
	dbPool,
	roomId,
	users,
	onlineList,
	isPersistent,
	roomName,
	callback
) {
	const self = this;
	Emitter.call( self );
	
	self.roomId = roomId;
	self.users = users;
	self.onlineList = onlineList;
	self.isPersistent = isPersistent;
	
	self.setting = {};
	self.handlerMap = {};
	self.list = [];
	
	self.init( dbPool, roomName, callback );
}

util.inherits( ns.Settings, Emitter );

// Public

ns.Settings.prototype.bind = function( userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user || !user.on )
		return;
	
	user.on( 'settings', loadSettings );
	user.on( 'setting', saveSetting );
	
	function loadSettings( e ) { self.handleLoad( e, userId ); }
	function saveSetting( e ) { self.saveSetting( e, userId ); }
}

ns.Settings.prototype.updateWorkgroups = function( available, assigned ) {
	const self = this;
	self.set( 'workgroups', {
		available : available,
		assigned  : assigned,
	});
}

ns.Settings.prototype.get = function( setting ) {
	const self = this;
	let settings = JSON.parse( self.settingStr );
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
	if ( !self.conn ) {
		callback( 'ERR_NO_CONN', null );
		return;
	}
	
	self.conn.send( event, userId, callback );
}

ns.Settings.prototype.broadcast = function( event, sourceId, wrapSource ) {
	const self = this;
	if ( !self.conn )
		return;
	
	self.conn.broadcast( event, sourceId, wrapSource );
}

ns.Settings.prototype.setPersistent = function( isPersistent, roomName ) {
	const self = this;
	self.isPersistent = isPersistent;
	self.handleRoomName( roomName );
}

ns.Settings.prototype.close = function() {
	const self = this;
	if ( self.conn )
		self.conn.close();
	
	if ( self.db )
		self.db.close();
	
	delete self.conn;
	delete self.db;
	delete self.roomId;
	delete self.isPersistent;
}

// Private

ns.Settings.prototype.init = function( dbPool, name, callback ) {
	const self = this;
	self.conn = new ns.UserSend( 'settings', self.users, self.onlineList );
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
	self.db.getSettings()
		.then( settings )
		.catch( loadErr );
	
	function settings( res ) {
		self.setDbSettings( res );
		self.set( 'roomName', name );
		done();
	}
	
	function loadErr( err ) {
		sLog( 'loadErr', err );
		self.setDefaults();
		done( err );
	}
	
	function done( err ) {
		callback( err, self.setting );
	}
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
	
	self.send( values, userId );
}

ns.Settings.prototype.saveSetting = function( event, userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user )
		return;
	
	if ( !self.checkIsAdmin( event.setting, userId ))
		return;
	
	const handler = self.handlerMap[ event.setting ];
	if ( !handler ) {
		sLog( 'saveSetting - no handler for ', event );
		return;
	}
	
	handler( event.value, userId );
}

ns.Settings.prototype.checkIsAdmin = function( setting, userId ) {
	const self = this;
	const user = self.users[ userId ];
	if ( !user.admin && !user.owner ) {
		self.sendError( setting, 'ERR_NOT_ADMIN', userId );
		return false;
	} else
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
	self.emit( 'workgroups', worg, userId );
}

module.exports = ns.Room;
