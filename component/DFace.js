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

/*
	DB offers basic functionality and helpers, extend it.
	Defined here:
	DB
	Account
	Room
*/

const util = require( 'util' );
const dbLog = require( './Log')( 'DB' );
const accLog = require( './Log' )( 'DB-Account' );
const roomLog = require( './Log' )( 'DB-Room' );
const msgLog = require( './Log' )( 'DB-Message' );
const invLog = require( './Log' )( 'DB-Invite' );
const uuid = require( './UuidPrefix' )();

var ns = {};

//
// DB
ns.DB = function( pool ) {
	if ( !( this instanceof ns.DB))
		return new ns.DB( pool );
	
	const self = this;
	self.pool = pool;
	
	self.dbInit();
}

// 'Public'

ns.DB.prototype.close = function() {
	const self = this;
	if ( !self.pool )
		return;
	
	delete self.pool;
}


ns.DB.prototype.query = function( fnName, values ) {
	const self = this;
	return new Promise( execQuery );
	function execQuery( resolve, reject ) {
		self.pool.getConnection( connBack );
		function connBack( err, conn ) {
			if ( err ) {
				reject( 'Could not obtain pool: ' + err );
				return;
			}
			
			const queryString = self.buildCall( fnName, values.length );
			conn.query( queryString, values, queryBack );
			function queryBack( err, res ) {
				conn.release();
				if ( err ) {
					reject( 'Query failed: ' + err );
					return;
				}
				
				const data = self.cleanResult( res );
				if ( null == data ) {
					reject( 'ERR_DB_PARSE' );
					return;
				}
				
				if( !data.pop ) {
					resolve( [] );
					return;
				}
				else
					data.pop();
				
				if ( 1 === data.length )
					resolve( data[ 0 ] );
				else
					resolve( data );
			}
		}
	}
}

// Private

ns.DB.prototype.buildCall = function( fnName, paramsLength ) {
	const self = this;
	var pph = getParamsPlaceholderStr( paramsLength );
	var call = 'CALL ' + fnName + '(' + pph + ')';
	return call;
	
	function getParamsPlaceholderStr( len ) {
		var parr = Array( len );
		var pph = parr.join( '?,' );
		pph += '?';
		return pph;
	}
}

ns.DB.prototype.cleanResult = function( dbRes ) {
	const self = this;
	var str = null;
	try {
		str = JSON.stringify( dbRes );
	} catch ( e ) {
		dbLog( 'failed to clean result', res );
		return str;
	}
	
	return JSON.parse( str );
}

ns.DB.prototype.dbInit = function() {
	const self = this;
}

//
// Account
//

ns.AccountDB = function( pool ) {
	const self = this;
	ns.DB.call( self, pool );
	//self.id = id;
	self.init();
}

util.inherits( ns.AccountDB, ns.DB );

// Public

ns.AccountDB.prototype.set = async function( fUserId, fUsername, name ) {
	const self = this;
	if ( !fUsername ) {
		accLog( 'set - fUsername is required', {
			i : fUserId,
			l : fUsername,
			n : name,
		});
		throw new Error( 'db.account.set - missing parameters' );
	}
	
	name = name || fUsername;
	fUserId = fUserId || null;
	var clientId = uuid.get( 'acc' );
	var settings = null;
	try {
		settings = JSON.stringify( global.config.server.account.settings );
	} catch( e ) {
		settings = '{}';
	}
	
	var values = [
		clientId,
		fUserId,
		fUsername,
		name,
		settings,
	];
	
	let res = await self.query( 'account_create', values );
	return res[ 0 ];
}

ns.AccountDB.prototype.setFUserId = async function( clientId, fUserId ) {
	const self = this;
	const values = [
		clientId,
		fUserId,
	];
	let res = null;
	try {
		res = await self.query( 'account_set_fuserid', values );
	} catch( err ) {
		accLog( 'setFUserId err', err );
		return false;
	}
	
	if ( !res )
		return false;
	
	const acc = res[ 0 ];
	return !!acc.fUserId;
	return true;
}

ns.AccountDB.prototype.getByFUsername = async function( fUsername ) {
	const self = this;
	const values = [ fUsername ];
	let res = null;
	try {
		res = await self.query( 'account_read_fusername', values );
	} catch ( err ) {
		accLog( 'get err', err );
		return null;
	}
	
	if ( !res )
		return null;
	
	const acc = res[ 0 ] || null;
	
	// lets remove some data
	if ( acc ) {
		delete acc._id;
		delete acc.pass;
	}
	
	return acc;
}

ns.AccountDB.prototype.getByFUserId = async function( fUserId ) {
	const self = this;
	const values = [ fUserId ];
	let res = null;
	try {
		res = await self.query( 'account_read_fuserid', values );
	} catch( err ) {
		accLog( 'get err', err );
		return null;
	}
	
	if ( !res )
		return null;
	
	const acc = res[ 0 ] || null;
	if ( acc ) {
		delete acc._id;
		delete acc.pass;
	}
	
	return acc;
}

ns.AccountDB.prototype.getById = function( accountId ) {
	const self = this;
	return new Promise( getAcc );
	function getAcc( resolve, reject ) {
		const values = [ accountId ];
		self.query( 'account_read_id', values )
			.then( accBack )
			.catch( reject );
		
		function accBack( res ) {
			if ( !res ) {
				reject( 'ERR_DB_INVALID_RES_WUT_???' );
				return;
			}
			
			let acc = res[ 0 ] || null;
			resolve( acc );
		}
	}
}

ns.AccountDB.prototype.remove = function( clientId ) {
	const self = this;
	var values = [ clientId ];
	return self.query( 'account_delete', values );
}

ns.AccountDB.prototype.touch = function( clientId ) {
	const self = this;
	var values = [ clientId ];
	return self.query( 'account_touch', values );
}

ns.AccountDB.prototype.setPass = function( clientId, pass ) {
	const self = this;
	var values = [
		clientId,
		pass,
	];
	return self.query( 'account_set_pass', values );
}

ns.AccountDB.prototype.updateName = async function( clientId, name ) {
	const self = this;
	var values = [
		clientId,
		name,
	];
	try {
		await self.query( 'account_set_name', values );
	} catch( err ) {
		accLog( 'updateName - query failed', err );
		return false;
	}
	
	return true;
}

ns.AccountDB.prototype.updateAvatar = async function( clientId, avatar ) {
	const self = this;
	accLog( 'updateAvatar - NYI', avatar );
	return true;
	
	const values = [
		clientId,
		avatar,
	];
	
	try {
		self.query( 'account_update_avatar', values );
	} catch( err ) {
		accLog( 'updateAvatar - query failed', err );
	}
}

ns.AccountDB.prototype.setSetting = function( clientId, key, value ) {
	const self = this;
	return new Promise( setting );
	function setting( resolve, reject ) {
		resolve( value );
	}
	// load settings
	
	// update with key/value
	
	// store settings
	//self.query( 'account_set_settings', values );
}

ns.AccountDB.prototype.getSettings = function( clientId ) {
	const self = this;
	accLog( 'getSettings - NYI', clientId );
}

ns.AccountDB.prototype.setActive = function( clientId, isActive ) {
	const self = this;
	var values = [
		clientId,
		isActive,
	];
	return self.query( 'account_set_active', values );
}

// Private
ns.AccountDB.prototype.init = function() {
	const self = this;
	
}

//
// ROOM
//

ns.RoomDB = function( pool, roomId ) {
	const self = this;
	ns.DB.call( self, pool );
	self.id = roomId;
	
	self.init();
}

util.inherits( ns.RoomDB, ns.DB );

// Public

ns.RoomDB.prototype.set = function( clientId, name, ownerId, isPrivate ) {
	const self = this;
	if ( !name || !ownerId )
		throw new Error( 'Room.db.set - invalid params' );
	
	clientId = clientId || uuid.get( 'room' );
	const settings = '{}';
	if ( null == isPrivate )
		isPrivate = false;
	
	const values = [
		clientId,
		name,
		ownerId,
		settings,
		isPrivate,
	];
	return new Promise( insertRoom );
	function insertRoom( resolve, reject ) {
		self.query( 'room_create', values )
			.then( roomBack )
			.catch( reject );
		
		function roomBack( res ) {
			if ( !res )
				reject( 'ERR_ROOM_SET_NO_ROWS' );
			
			resolve( res[ 0 ] );
		}
	}
}

ns.RoomDB.prototype.get = function( clientId ) {
	const self = this;
	return new Promise( loadRoom );
	function loadRoom( resolve, reject ) {
		const values = [ clientId ];
		self.query( 'room_read', values )
			.then( loaded )
			.catch( reject );
		
		function loaded( res ) {
			if ( res )
				resolve( res[ 0 ] || null );
			else
				reject( 'ERR_NO_ROOM_???' );
		}
	}
}

ns.RoomDB.prototype.remove = function( clientId ) {
	const self = this;
	const values = [ clientId ];
	return self.query( 'room_delete', values );
}

ns.RoomDB.prototype.touch = function( clientId ) {
	const self = this;
	const values = [ clientId ];
	return self.query( 'room_touch', values );
}

ns.RoomDB.prototype.setName = function( name, roomId ) {
	const self = this;
	roomId = roomId || self.id;
	const values = [
		roomId,
		name,
	];
	return self.query( 'room_set_name', values );
}

ns.RoomDB.prototype.setOwner = function( clientId, ownerId ) {
	const self = this;
	const values = [
		clientId,
		ownerId,
	];
	return self.query( 'room_set_owner', values );
}

// auth things

ns.RoomDB.prototype.loadAuthorizations = function( roomId ) {
	const self = this;
	if ( !roomId )
		throw new Error( 'dbRoom.loadAuthorizations - roomId missing' );
	
	return new Promise( loadAuth );
	function loadAuth( resolve, reject ) {
		var values = [ roomId ];
		self.query( 'auth_get_for_room', values )
			.then( loadBack )
			.catch( reject );
			
		function loadBack( res ) {
			if ( !res ) {
				reject( 'ERR_NO_ROWS_???', res );
				return;
			}
			
			resolve( res );
		}
	}
}

ns.RoomDB.prototype.getForAccount = function( accountId, workgroups ) {
	const self = this;
	let wgIds = null;
	if ( workgroups )
		wgIds = workgroups.join( '|' );
	
	return new Promise( getRooms );
	function getRooms( resolve, reject ) {
		let accountRooms = [];
		let workgroupRooms = [];
		getAccountRooms( accRoomsBack );
		function accRoomsBack( err, accRooms ) {
			if ( err )
				roomLog( 'accRoomsBack - err', err );
			else
				accountRooms = accRooms;
			
			if ( wgIds )
				getWorkgroupRooms( wgRoomsBack );
			else
				done();
		}
		
		function wgRoomsBack( err, wgRooms ) {
			if ( err )
				roomLog( 'wgRoomsBack - err', err );
			else
				workgroupRooms = wgRooms;
			
			done();
		}
		
		function done() {
			let rooms = accountRooms.concat( workgroupRooms );
			resolve( rooms );
		}
		
		function getAccountRooms( callback ) {
			const values = [ accountId ];
			self.query( 'auth_get_for_account', values )
				.then( accBack )
				.catch( accErr );
			
			function accBack( res ) { callback( null, res ); }
			function accErr( err ) { callback( err, null ); }
		}
		
		function getWorkgroupRooms( callback ) {
			const values = [
				accountId,
				wgIds,
			];
			self.query( 'auth_get_for_workgroups', values )
				.then( wgBack )
				.catch( wgErr );
				
			function wgBack( res ) {
				const rows = res;
				const mapped = {};
				rows.forEach( setInMap );
				const ids = Object.keys( mapped );
				const list = ids.map( rid => mapped[ rid ]);
				callback( null, list );
				
				function setInMap( dbRoom ) {
					let alreadySet = mapped[ dbRoom.clientId ];
					if ( alreadySet ) {
						alreadySet.wgs.push( dbRoom.fId );
					}
					else {
						let room = {
							clientId : dbRoom.clientId,
							wgs      : [],
						};
						room.wgs.push( dbRoom.fId );
						mapped[ dbRoom.clientId ] = room;
					}
				}
			}
			function wgErr( err ) { callback( err, null ); }
		}
	}
	
	function getId( wg ) {
		return wg.fId;
	}
}

ns.RoomDB.prototype.getAssignedWorkgroups = async function( roomId ) {
	const self = this;
	roomId = roomId || self.id;
	if ( !roomId )
		return null;
	
	let values = [ roomId, ];
	let res = null;
	try {
		res = await self.query( 'room_get_assigned_workgroups', values )
	} catch( err ) {
		roomLog( 'getAssignedWorkgroups - query err', err );
		return null;
	}
	
	let worgs = res;
	return worgs;
}

ns.RoomDB.prototype.assignWorkgroup = function( fWgId, setById, roomId ) {
	const self = this;
	return new Promise( assign );
	function assign( resolve, reject ) {
		roomId = roomId || self.id;
		if ( !roomId || !fWgId || !setById ) {
			roomLog( 'assingWorkgroup - invalid args', {
				rid   : roomId,
				fWgId : fWgId,
				sid   : setById,
			});
			reject( 'ERR_INVALID_ARGS' );
			return;
		}
		
		const values = [
			roomId,
			fWgId,
			setById,
		];
		self.query( 'room_assign_workgroup', values )
			.then( done )
			.catch( reject );
			
		function done( rows ) {
			resolve( rows[ 0 ] );
		}
	}
}

ns.RoomDB.prototype.dismissWorkgroup = function( fWgId, roomId ) {
	const self = this;
	return new Promise( dismiss );
	function dismiss( resolve, reject ) {
		roomId = roomId || self.id;
		if ( !fWgId || !roomId ) {
			reject( 'ERR_INVALID_ARGS' );
			return;
		}
		const values = [
			roomId,
			fWgId,
		];
		self.query( 'room_dismiss_workgroup', values )
			.then( done )
			.catch( reject );
		
		function done( rows) {
			resolve( rows[ 0 ]);
		}
	}
}

ns.RoomDB.prototype.setRelation = async function( accIdA, accIdB ) {
	const self = this;
	const relationId = uuid.get( 'rel' );
	if ( accIdA === accIdB ) {
		roomLog( 'setRelation - same ids', {
			a : accIdA,
			b : accIdB,
		});
		throw new Error( 'ERR_INVALID_RELATION_ID' );
	}
	
	const values = [
		relationId,
		accIdA,
		accIdB,
		null,
	];
	let res = null;
	try {
		res = await self.query( 'user_relation_create', values );
	} catch( e ) {
		roomLog( 'setting relation failed', {
			e : e.stack || e,
			v : values,
		});
		throw new Error( 'ERR_DB_FAILED' );
	}
	
	if ( !res )
		throw new Error( 'ERR_DB_SET_RELATION' );
	
	return self.rowsToRelation( res );
}

ns.RoomDB.prototype.assignRelationRoom = async function( relationId, roomId ) {
	const self = this;
	const values = [
		relationId,
		roomId,
	];
	
	let res = null;
	try {
		res = await self.query( 'user_relation_assign_room', values );
	} catch( e ) {
		roomLog( 'assignRelationRoom - db fail', e );
		throw new Error( 'ERR_DB_ASSING_RELATION_ROOM' );
	}
	
	return true;
}

ns.RoomDB.prototype.getRelation = async function( accIdA, accIdB ) {
	const self = this;
	const values = [
		accIdA,
		accIdB,
	];
	let res = null;
	try {
		res = await self.query( 'user_relation_read', values );
	} catch ( e ) {
		roomLog( 'getRelation - query failed', e );
		throw new Error( 'ERR_DB_FAILED' );
	}
	
	if ( !res )
		return null;
	
	return self.rowsToRelation( res );
}

ns.RoomDB.prototype.getRelationsFor = async function( accId ) {
	const self = this;
	const values = [
		accId,
	];
	let res = null;
	try {
		res = await self.query( 'user_relation_read_all_for', values );
	} catch( e ) {
		roomLog( 'getRelationsFor - db err', e.stack || e );
		throw new Error( 'ERR_DB_FAILED' );
	}
	
	if ( !res )
		return null;
	
	return res;
}

ns.RoomDB.prototype.authorize = async function( roomId, accountIds ) {
	const self = this;
	const accountIdStr = accountIds.join( '|' );
	const values = [
		roomId,
		accountIdStr,
	];
	try {
		await self.query( 'auth_add', values )
	} catch( err ) {
		roomLog( 'authorize - query fail', err );
		return false;
	}
	
	return true;
}

ns.RoomDB.prototype.check = function( accountId, roomId ) {
	const self = this;
	roomId = roomId || self.id;
	return new Promise( checkAuth );
	function checkAuth( resolve, reject ) {
		let values = [
			roomId,
			accountId,
		];
		
		self.query( 'auth_check', values )
			.then( checked )
			.catch( reject );
		
		function checked( rows ) {
			resolve( !!rows[ 0 ]);
		}
	}
}

ns.RoomDB.prototype.revoke = function( roomId, accountId ) {
	const self = this;
	const values = [
		roomId,
		accountId,
	];
	return self.query( 'auth_remove', values );
}

ns.RoomDB.prototype.getSettings = function( roomId ) {
	const self = this;
	roomId = roomId || self.id;
	return new Promise( get );
	function get( resolve, reject ) {
		if ( !roomId ) {
			reject( 'ERR_NO_ROOMID' );
			return;
		}
		
		let values = [ roomId ];
		self.query( 'room_settings_get', values )
			.then( ok )
			.catch( reject );
		
		function ok( res ) {
			if ( !res ) {
				reject( 'ERR_NO_ROWS' );
				return;
			}
			
			let obj = res[ 0 ];
			if ( !obj || !obj.settings ) {
				reject( 'ERR_NO_SETTINGS' );
				return;
			}
			
			let settings = null
			try {
				settings = JSON.parse( obj.settings );
			} catch( e ) {
				reject( 'ERR_INVALID_JSON' );
				return;
			}
			
			resolve( settings );
		}
	}
}

ns.RoomDB.prototype.setSetting = function( key, value, roomId ) {
	const self = this;
	let obj = {};
	obj[ key ] = value;
	let jsonStr = JSON.stringify( obj );
	roomId = roomId || self.id;
	const values = [
		roomId,
		key,
		jsonStr,
	];
	
	return self.query( 'room_settings_set_key_value', values );
}

ns.RoomDB.prototype.removeSetting = function( key, roomId ) {
	const self = this;
	roomId = roomId || self.id;
	const values = [
		roomId,
		key,
	];
	return self.query( 'room_settings_remove_key', values );
}


// Pirvate

ns.RoomDB.prototype.init = function() {
	const self = this;
	
}

ns.RoomDB.prototype.rowsToRelation = function( rows ) {
	const self = this;
	if ( !rows || ( 2 !== rows.length ))
		return null;
	
	const rowA = rows[ 0 ];
	const rowB = rows[ 1 ];
	const relation = {
		clientId    : rowA.relationId,
		roomId      : rowA.roomId,
		relations   : rows,
	};
	relation[ rowA.userId ] = rowA;
	relation[ rowB.userId ] = rowB;
	return relation;
}


//
// Message
//

ns.MessageDB = function( pool, roomId ) {
	const self = this;
	ns.DB.call( self, pool );
	self.roomId = roomId;
	
	self.init();
}

util.inherits( ns.MessageDB, ns.DB );

// public

ns.MessageDB.prototype.set = async function( conf ) {
	const self = this;
	const values = [
		conf.msgId,
		conf.roomId,
		conf.fromId,  // accountId
		conf.time,    // timestamp
		conf.type || 'msg',
		conf.name,
		conf.message,
	];
	
	await self.query( 'message_set', values );
}

ns.MessageDB.prototype.setForRelation = async function( msg, relationId, activeList ) {
	const self = this;
	try {
		await self.set( msg );
	} catch( err ) {
		msgLog( 'setForRelation, set msg - query failed', err );
		return false;
	}
	
	const values = [
		msg.msgId,
		relationId,
		activeList[ 0 ] || null,
		activeList[ 1 ] || null,
	];
	try {
		await self.query( 'user_relation_update_messages', values );
	} catch ( err ) {
		msgLog( 'setForRelation, update relation - query failed', err );
		return false;
	}
	
	return true;
}

ns.MessageDB.prototype.getRelationState = async function( relationId, contactId ) {
	const self = this;
	const values = [
		relationId,
		contactId,
	];
	let res;
	try {
		res = await self.query( 'user_relation_state', values );
	} catch( err ) {
		roomLog( 'getRelationState - query err', err );
		return null;
	}
	
	if ( !res )
		return null;
	
	let unreadRes = res[ 0 ];
	let lastMessageRes = self.parseItems( res[ 1 ]);
	return {
		unreadMessages : unreadRes[ 0 ].unreadMessages,
		lastMessage    : lastMessageRes[ 0 ],
	};
}

ns.MessageDB.prototype.updateUserLastRead = async function( relationId, userId, msgId ) {
	const self = this;
	const values = [
		relationId,
		userId,
		msgId,
	];
	try {
		await self.query( 'user_relation_update_last_read', values );
	} catch( err ) {
		msgLog( 'updateUserLastRead - db err', err );
		return false;
	}
	
	return true;
}

ns.MessageDB.prototype.get = async function( eventId ) {
	const self = this;
	if ( !eventId || !self.roomId )
		throw new Error( 'ERR_INVALID_ARGS' );
		
	const values = [
		eventId,
	];
	const rows = await self.query( 'message_get_by_id', values );
	const events = self.parseItems( rows );
	return events;
}

ns.MessageDB.prototype.getBefore = async function( firstId, length ) {
	const self = this;
	const values = [
		self.roomId
	];
	
	if ( firstId )
		values.push( firstId );
	
	values.push( length || 50 );
	
	let queryFn = 'message_get_desc';
	if ( firstId )
		queryFn = 'message_get_before';
	
	const rows = await self.query( queryFn, values );
	if ( firstId && !rows.length ) // end of log
		return null;
	else
		return self.parseItems( rows );
}

ns.MessageDB.prototype.getAfter = async function( lastId, length ) {
	const self = this;
	const values = [
		self.roomId,
	];
	
	if ( lastId )
		values.push( lastId );
	
	values.push( length || 50 );
	let queryFn = 'message_get_asc';
	if ( lastId )
		queryFn = 'message_get_after';
	
	const rows = await self.query( queryFn, values );
	if ( lastId && !rows.length ) // end of log
		return null;
	else
		return self.parseItems( rows );
}

ns.MessageDB.prototype.update = async function(
	eventId,
	contentUpdate,
	reason,
	editerId
) {
	const self = this;
	reason = reason || 'espen er kul';
	let events = null;
	try {
		events = await self.get( eventId );
	} catch( e ) {
		return e;
	}
	
	if ( !events )
		return 'ERR_NOT_FOUND';
	
	const dbMsg = events[ 0 ].data;
	let queryRes = null;
	const isGrace = isInGracePeriod( dbMsg.time, editerId );
	const isAuthor = dbMsg.fromId === editerId;
	//if ( isGrace && isAuthor ) {
	if ( 1 ) {
		try {
			queryRes = await update( dbMsg.msgId, contentUpdate );
		} catch ( e ) {
			msgLog( 'err', e );
			return e;
		}
	}
	/*
	else {
		try {
			queryRes = await updateWithHistory(
				dbMsg.msgId,
				dbMsg.message,
				contentUpdate,
				reason,
				editerId
			);
		} catch ( e ) {
			return e;
		}
	}
	*/
	
	const rows = queryRes || [];
	return rows[ 0 ] || null;
	
	function isInGracePeriod( eTime, accId ) {
		return true;
	}
	
	async function update( eId, message ) {
		let values = [
			eId,
			message,
		];
		return self.query( 'message_update', values );
	}
	
	async function updateWithHistory(
		evId,
		original,
		update,
		reason,
		accId
	) {
		
	}
}

// Private

ns.MessageDB.prototype.init = function() {
	const self = this;
	
}

ns.MessageDB.prototype.parseItems = function( items ) {
	const self = this;
	if ( !items || ( null == items.length ))
		return null;
	
	const events = items.map( toTypeData );
	return events;
	
	function toTypeData( item ) {
		const event = {
			type : item.type,
			data : null,
		};
		
		delete item.type;
		event.data = item;
		return event;
	}
}


// Invites

// roomId is optonal, it ca be passed to the methods aswell
ns.InviteDB = function( pool, roomId ) {
	const self = this;
	self.roomId = roomId;
	ns.DB.call( self, pool );
	
	self.init();
}

util.inherits( ns.InviteDB, ns.DB );

// Public

ns.InviteDB.prototype.set = function( token, singleUse, createdBy, roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	singleUse = !!singleUse;
	const values = [
		token,
		roomId,
		singleUse,
		createdBy,
	];
	
	return new Promise( setInvite );
	function setInvite( resolve, reject ) {
		self.query( 'invite_set', values )
			.then( invSet )
			.catch( reject );
		
		function invSet( res ) {
			resolve( true );
		}
	}
}

ns.InviteDB.prototype.get = function( token ) {
	const self = this;
	invLog( 'get - NYI', token );
}

ns.InviteDB.prototype.getForRoom = function( roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		roomId,
	];
	
	return new Promise(( resolve, reject ) => {
		self.query( 'invite_get_room', values )
			.then( tokensBack )
			.catch( reject );
			
		function tokensBack( res ) {
			if ( !res ) {
				reject( 'ERR_DB_INVALID_RESULT' );
				return;
			}
			
			resolve( res );
		}
	});
}

ns.InviteDB.prototype.checkForRoom = async function( token, roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		token,
		roomId,
	];
	let res = null;
	try {
		res = await self.query( 'invite_check_room', values );
	} catch( err ) {
		invLog( 'checkForRoom - query fail', err );
		return null;
	}
	
	return res[ 0 ];
}

ns.InviteDB.prototype.invalidate = function( token, invalidatedBy ) {
	const self = this;
	invalidatedBy = invalidatedBy || null;
	const values = [
		token,
		invalidatedBy,
	];
	return new Promise( invalidated );
	function invalidated( resolve, reject ) {
		self.query( 'invite_invalidate', values )
			.then( success )
			.catch( reject );
			
		function success( res ) {
			resolve( true );
		}
	}
}

// Private

ns.InviteDB.prototype.init = function() {
	const self = this;
}


module.exports = ns;
