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
			
			var queryString = self.buildCall( fnName, values.length );
			conn.query( queryString, values, queryBack );
			function queryBack( err, res ) {
				conn.release();
				if ( err ) {
					reject( 'Query failed: ' + err );
					return;
				}
				
				var data = self.cleanResult( res );
				if ( null == data ) {
					reject( 'ERR_DB_PARSE' );
					return;
				}
				var rows = data[ 0 ];
				var meta = data[ 1 ];
				var ret = {
					rows : rows,
					meta : meta,
				}
				resolve( ret );
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

ns.AccountDB.prototype.set = function( login, pass, name ) {
	const self = this;
	if ( !login ) {
		accLog( 'set - login is required', {
			l : login,
			p : pass,
			n : name,
		});
		throw new Error( 'db.account.set - missing parameters' );
	}
	
	pass = pass || null;
	name = name || null;
	var clientId = uuid.get( 'acc' );
	var settings = null;
	try {
		settings = JSON.stringify( global.config.server.account.settings );
	} catch( e ) {
		settings = '{}';
	}
	
	var values = [
		clientId,
		login,
		pass,
		name,
		settings,
	];
	return new Promise( doCreate );
	function doCreate( resolve, reject ) {
		self.query( 'account_create', values )
			.then( createBack )
			.catch( reject );
		
		function createBack( res ) {
			resolve( res.rows );
		}
	}
}

ns.AccountDB.prototype.get = function( login ) {
	const self = this;
	return new Promise( readAcc );
	function readAcc( resolve, reject ) {
		var values = [ login ];
		self.query( 'account_read', values )
			.then( readBack )
			.catch( reject );
		
		function readBack( res ) {
			const acc = res.rows[ 0 ] || null;
			
			// lets remove some data
			if ( acc ) {
				delete acc._id;
				delete acc.pass;
			}
			
			resolve( acc );
		}
	}
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
			if ( !res || res.rows ) {
				reject( 'ERR_DB_INVALID_RES_WUT_???' );
				return;
			}
			
			resolve( res.rows[ 0 ]);
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

ns.AccountDB.prototype.updateName = function( clientId, name ) {
	const self = this;
	var values = [
		clientId,
		name,
	];
	return self.query( 'account_set_name', values );
}

ns.AccountDB.prototype.updateAvatar = function( clientId, avatar ) {
	const self = this;
	const values = [
		clientId,
		avatar,
	];
	return new Promise( call );
	function call( resolve, reject ) {
		if ( !clientId || !avatar ) {
			reject( 'ERR_INVALID_ARGS' );
			return;
		}
		
		self.query( 'account_update_avatar', values )
			.then( ok )
			.catch( reject );
			
		function ok( res ) {
			resolve( res );
		}
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
		isPrivate = true;
	
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
			if ( !res || !res.rows )
				reject( 'ERR_ROOM_SET_NO_ROWS' );
			
			resolve( res.rows[ 0 ] );
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
			if ( res && res.rows )
				resolve( res.rows[ 0 ] || null );
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

ns.RoomDB.prototype.setName = function( clientId, name ) {
	const self = this;
	const values = [
		clientId,
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
			if ( !res || !res.rows ) {
				reject( 'ERR_NO_ROWS_???', res );
				return;
			}
			
			resolve( res.rows );
		}
	}
}

ns.RoomDB.prototype.getForAccount = function( accountId, workgroups ) {
	const self = this;
	let wgIds = null;
	if ( workgroups )
		wgIds = workgroups.map( getId ).join( '|' );
	
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
			
			function accBack( res ) { callback( null, res.rows ); }
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
				const rows = res.rows;
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

ns.RoomDB.prototype.getAssignedWorkgroups = function() {
	const self = this;
	return new Promise( get );
	function get( resolve, reject ) {
		if ( !self.id ) {
			reject ( 'ERR_NO_ROOMID' );
			return;
		}
		
		let values = [ self.id, ];
		self.query( 'room_get_assigned_workgroups', values )
			.then( worgsBack )
			.catch( reject );
		
		function worgsBack( res ) {
			if ( !res || !res.rows ) {
				reject( 'ERR_NO_ROWS' );
				return;
			}
			
			let worgs = res.rows;
			resolve( worgs );
		}
	}
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
			
		function done( res ) {
			const rows = res.rows;
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
		
		function done( res ) {
			const rows = res.rows;
			resolve( rows[ 0 ]);
		}
	}
}

ns.RoomDB.prototype.authorize = function( roomId, accountIds ) {
	const self = this;
	const accountIdStr = accountIds.join( '|' );
	const values = [
		roomId,
		accountIdStr,
	];
	return new Promise( addAuth );
	function addAuth( resolve, reject ) {
		self.query( 'auth_add', values )
			.then( authSet )
			.catch( reject );
		
		function authSet( res ) {
			resolve( res.rows );
		}
	}
}

ns.RoomDB.prototype.check = function( accountId, roomId ) {
	const self = this;
	console.log( 'RoomDB.check', accountId );
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
		
		function checked( res ) {
			let rows = res.rows;
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
			if ( !res || !res.rows ) {
				reject( 'ERR_NO_ROWS' );
				return;
			}
			
			let obj = res.rows[ 0 ];
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

ns.MessageDB.prototype.set = function( conf ) {
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
	
	return new Promise( addMsg );
	function addMsg( resolve, reject ) {
		self.query( 'message_set', values )
			.then( resolve )
			.catch( reject );
	}
}

ns.MessageDB.prototype.getBefore = function( firstId, length ) {
	const self = this;
	const values = [
		self.roomId
	];
	
	if ( firstId )
		values.push( firstId );
	
	values.push( length || 50 );
	
	return new Promise( load );
	function load( resolve, reject ) {
		let queryFn = 'message_get_desc';
		if ( firstId )
			queryFn = 'message_get_before';
		
		self.query( queryFn, values )
			.then( msgBack )
			.catch( reject );
		
		function msgBack( res ) {
			const rows = res.rows || [];
			if ( firstId && !rows.length ) // end of log
				resolve( null )
			else
				resolve( rows );
		}
	}
}

ns.MessageDB.prototype.getAfter = function( lastId, length ) {
	const self = this;
	const values = [
		self.roomId,
	];
	
	if ( lastId )
		values.push( lastId );
	
	values.push( length || 50 );
	return new Promise( load );
	function load( resolve, reject ) {
		let queryFn = 'message_get_asc';
		if ( lastId )
			queryFn = 'message_get_after';
		
		self.query( queryFn, values )
			.then( msgsBack )
			.catch( reject );
			
		function msgsBack( res ) {
			const rows = res.rows || [];
			if ( lastId && !rows.length ) // end of log
				resolve( null );
			else
				resolve( rows );
		}
	}
}

// Private

ns.MessageDB.prototype.init = function() {
	const self = this;
	
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
			if ( !res || !res.rows ) {
				reject( 'ERR_DB_INVALID_RESULT' );
				return;
			}
			
			resolve( res.rows );
		}
	});
}

ns.InviteDB.prototype.checkForRoom = function( token, roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		token,
		roomId,
	];
	return new Promise( validToken );
	function validToken( resolve, reject ) {
		self.query( 'invite_check_room', values )
			.then( success )
			.catch( reject );
			
		function success( res ) {
			if ( !res || !res.rows )
				resolve( null );
			else
				resolve( res.rows[ 0 ]);
		}
	}
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
