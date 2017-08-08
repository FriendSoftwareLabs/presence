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

ns.DB.prototype.dbClose = function() {
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
	accLog( 'setSetting', {
		cid   : clientId,
		key   : key,
		value : value,
	});
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
	accLog( 'getSettings', clientId );
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

ns.AccountDB.prototype.close = function() {
	const self = this;
	self.dbClose();
}

//
// ROOM
//

ns.RoomDB = function( pool, id ) {
	const self = this;
	ns.DB.call( self, pool );
	self.id = id;
	
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

ns.RoomDB.prototype.getForAccount = function( accountId ) {
	const self = this;
	return new Promise( getRooms );
	function getRooms( resolve, reject ) {
		const values = [ accountId ];
		self.query( 'auth_get_for_account', values )
			.then( roomsBack )
			.catch( reject );
		
		function roomsBack( res ) {
			if ( !res ) {
				reject();
				return;
			}
			
			resolve( res.rows );
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

ns.RoomDB.prototype.revoke = function( roomId, accountId ) {
	const self = this;
	const values = [
		roomId,
		accountId,
	];
	return self.query( 'auth_remove', values );
}

// Pirvate

ns.RoomDB.prototype.init = function() {
	const self = this;
	
}

ns.RoomDB.prototype.close = function() {
	const self = this;
	self.dbClose();
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

ns.MessageDB.prototype.get = function( length, startId ) {
	const self = this;
	if ( null == length )
		length = 50;
	
	const values = [
		self.roomId,
		length,
	];
	
	if ( null != startId )
		values.push( startId );
	
	return new Promise( loadMessages );
	function loadMessages( resolve, reject ) {
		let queryFn = 'message_get';
		if ( 3 === values.length ) // startId
			queryFn = 'message_get_from';
		
		self.query( queryFn, values )
			.then( msgBack )
			.catch( reject );
		
		function msgBack( res ) {
			const rows = res.rows || [];
			
			if ( 3 === values.length && !rows.length ) // end of log
				resolve( null )
			else
				resolve( rows );
		}
	}
}

// Private

ns.MessageDB.prototype.init = function() {
	const self = this;
	
}

module.exports = ns;
