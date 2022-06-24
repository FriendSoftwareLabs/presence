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
const iSLog = require( './Log' )( 'ISettings' );
const uuid = require( './UuidPrefix' )();

var ns = {};

//
// DB
ns.DB = function( pool ) {
	const self = this;
	self.pool = pool;
	
	self.dbInit();
}

// 'Public'

ns.DB.prototype.close = function() {
	const self = this;
	if ( self.settings ) {
		self.settings.close();
		delete self.settings;
	}
	
	delete self.pool;
}


ns.DB.prototype.query = function( fnName, values ) {
	const self = this;
	return new Promise( execQuery );
	function execQuery( resolve, reject ) {
		const conn = self.pool.getConnection();
		values = values || [];
		const queryString = self.buildCall( fnName, values.length );
		conn.query( queryString, values, queryBack );
		function queryBack( err, res ) {
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

// Private

ns.DB.prototype.buildCall = function( fnName, paramsLength ) {
	const self = this;
	var pph = getParamsPlaceholderStr( paramsLength );
	var call = 'CALL ' + fnName + '(' + pph + ')';
	return call;
	
	function getParamsPlaceholderStr( len ) {
		if ( !len )
			return '';
		
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

ns.AccountDB.prototype.set = async function( 
	fUserId,
	fUsername,
	fLastUpdate,
	fIsDisabled,
	name
) {
	const self = this;
	if ( !fUserId ) {
		accLog( 'set - fUserId is required', {
			i : fUserId,
			l : fUsername,
			n : name,
		});
		throw new Error( 'db.account.set - missing parameters' );
	}
	
	fIsDisabled = fIsDisabled || null;
	name = name || fUsername;
	const clientId = uuid.get( 'acc' );
	let settings = null;
	try {
		settings = JSON.stringify( global.config.server.account.settings );
	} catch( e ) {
		settings = '{}';
	}
	
	const values = [
		clientId,
		fUserId,
		fUsername,
		fLastUpdate,
		fIsDisabled,
		name,
		settings,
	];
	
	let res = null;
	try {
		res = await self.query( 'account_create', values );
	} catch( ex ) {
		accLog( 'set - query failed', ex );
		return false;
	}
	
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
		accLog( 'getByFUsername err', err );
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
		accLog( 'getByFUserId err', err );
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

ns.AccountDB.prototype.getById = async function( accountId ) {
	const self = this;
	if ( 'string' != typeof( accountId )) {
		accLog( 'getById - invalid accountId', accountId );
		throw new Error( 'rabble rabble rabble' );
	}
	
	const values = [ accountId ];
	let res = null;
	try {
		res = await self.query( 'account_read_id', values );
	} catch( e ) {
		accLog( 'getById - query fail', {
			e : e,
			v : values,
		}, 4 );
		return null;
	}
	
	if ( !res || !res[ 0 ]) {
		return null;
	}
	
	let acc = res[ 0 ];
	return acc;
}

ns.AccountDB.prototype.getAlphaNumList = async function() {
	const self = this;
	let res = null;
	try {
		res = await self.query( 'account_read_alphanum' );
	} catch( qex ) {
		accLog( 'getAlphaNumList query ex', qex );
		return [];
	}
	
	const list = res.map( u => u.clientId );
	return list;
}

ns.AccountDB.prototype.search = async function( needle ) {
	const self = this;
	if ( null == needle || !needle.trim ) {
		accLog( 'search - invalid needle', needle );
		return [];
	}
	
	const searchStr = needle.trim();
	if ( '' == searchStr ) {
		accLog( 'search - empty search string after trim', needle );
		return [];
	}
	
	const values = [ needle ];
	let rows = null;
	try {
		rows = await self.query( 'account_search', values );
	} catch( qex ) {
		accLog( 'search, query ex', qex );
		return [];
	}
	
	return rows.map( r => r.clientId );
	
}

ns.AccountDB.prototype.remove = function( clientId ) {
	const self = this;
	const values = [ clientId ];
	return self.query( 'account_delete', values );
}

ns.AccountDB.prototype.touch = function( clientId ) {
	const self = this;
	const values = [ clientId ];
	return self.query( 'account_touch', values );
}

ns.AccountDB.prototype.setPass = function( clientId, pass ) {
	const self = this;
	const values = [
		clientId,
		pass,
	];
	return self.query( 'account_set_pass', values );
}

ns.AccountDB.prototype.updateName = async function( clientId, name ) {
	const self = this;
	const values = [
		clientId,
		name,
	];
	try {
		await self.query( 'account_update_name', values );
	} catch( err ) {
		accLog( 'updateName - query failed', err );
		return false;
	}
	
	return true;
}

ns.AccountDB.prototype.updateAvatar = async function( clientId, avatar ) {
	const self = this;
	const values = [
		clientId,
		avatar,
	];
	
	try {
		self.query( 'account_update_avatar', values );
	} catch( err ) {
		accLog( 'updateAvatar - query failed', err );
		return false;
	}
	
	return true;
}

ns.AccountDB.prototype.updateFIsDisabled = async function( clientId, isDisabled ) {
	const self = this;
	const values = [
		clientId,
		!!isDisabled,
	];
	try {
		self.query( 'account_update_fisdisabled', values );
	} catch( ex ) {
		accLog( 'updateIsDisabled - query failed', err );
		return false;
	}
	
	return true;
}

ns.AccountDB.prototype.updateFLastUpdate = async function( clientId, updateTime ) {
	const self = this;
	const values = [
		clientId,
		updateTime,
	];
	try {
		self.query( 'account_update_flastupdate', values );
	} catch( ex ) {
		accLog( 'updateFLastUpdate - query failed', ex );
		return false;
	}
	
	return true;
}

ns.AccountDB.prototype.setSetting = async function( clientId, key, value ) {
	const self = this;
	return await self.settings.setSetting( clientId, key, value );
}

ns.AccountDB.prototype.getSettings = function( clientId ) {
	const self = this;
	//accLog( 'getSettings - NYI', clientId );
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
	self.settings = new ns.ISettings( self, 'account' );
	
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

ns.RoomDB.prototype.set = async function(
	clientId,
	name,
	ownerId,
	isPrivate,
	settings
) {
	const self = this;
	if ( !name || !ownerId )
		throw new Error( 'Room.db.set - invalid params' );
	
	clientId = clientId || uuid.get( 'room' );
	settings = settings || '{}';
	if ( null == isPrivate )
		isPrivate = false;
	
	const values = [
		clientId,
		name,
		ownerId,
		settings,
		isPrivate,
	];
	
	let res = null;
	try {
		res = await self.query( 'room_create', values );
	} catch( ex ) {
		roomLog( 'set query ex', ex );
		return null;
	}
	
	if ( !res )
		return null;
	
	const conf = res[ 0 ];
	conf.persistent = true;
	
	return conf;
}

ns.RoomDB.prototype.get = async function( clientId ) {
	const self = this;
	const values = [ clientId ];
	let res = null;
	try {
		res = await self.query( 'room_read', values );
		
	} catch( ex ) {
		roomLog( 'get query ex', ex );
		return null;
	}
	
	if ( !res )
		return null;
	
	return res[ 0 ];
}

ns.RoomDB.prototype.getInfo = async function( clientId ) {
	const self = this;
	const values = [ clientId ];
	let res = null;
	try {
		res = await self.query( 'room_read_all', values );
	} catch( ex ) {
		roomLog( 'getInfo query ex', ex );
		return null;
	}
	
	if ( !res )
		return null;
	
	const info = {
		room        : res[ 0 ][ 0 ],
		authorized  : res[ 1 ],
		workgroups  : res[ 2 ],
		invites     : res[ 3 ],
		messages    : res[ 4 ][ 0 ],
	};
	
	return info;
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

ns.RoomDB.prototype.loadAuthorizationsForRoom = async function( roomId, includeDisabled ) {
	const self = this;
	if ( !roomId )
		throw new Error( 'dbRoom.loadAuthorizationsForRoom - roomId missing' );
	
	const values = [ roomId ];
	let res = null;
	try {
		res = await self.query( 'auth_get_for_room', values );
	} catch( ex ) {
		roomLog( 'failed to load auths', {
			roomId : roomId,
			error  : ex,
		});
		return null;
	}
	
	if ( !res )
		throw new Error( 'ERR_NO_ROWS_???' );
	
	if ( includeDisabled )
		return res.map( u => u.clientId );
	else
		return res
			.filter( u => !u.fIsDisabled )
			.map( u => u.clientId );
	
}

ns.RoomDB.prototype.loadAuthorizationsForAccount = async function( accId ) {
	const self = this;
	const values = [ accId ];
	let res = null;
	try {
		res = await self.query( 'auth_get_for_account', values );
	} catch( ex ) {
		roomLog( 'auth_get_for_account failed', ex );
		return null;
	}
	
	return res;
}

ns.RoomDB.prototype.getForAccount = async function( accountId, workgroups ) {
	const self = this;
	let wgIds = null;
	if ( workgroups )
		wgIds = workgroups.join( '|' );
	
	let accountRooms = await self.loadAuthorizationsForAccount( accountId );
	let worgRooms = null;
	if ( wgIds )
		worgRooms = await getWorkgroupRooms( accountId, wgIds );
	
	let rooms = null;
	if ( worgRooms )
		rooms = accountRooms.concat( worgRooms );
	else
		rooms = accountRooms;
	
	return rooms;
	
	async function getWorkgroupRooms() {
		const values = [
			accountId,
			wgIds,
		];
		let res = null;
		try {
			res = await self.query( 'auth_get_for_workgroups', values );
		} catch( ex ) {
			return null;
		}
		
		const rows = res;
		const mapped = {};
		rows.forEach( setInMap );
		const ids = Object.keys( mapped );
		const list = ids.map( rid => mapped[ rid ]);
		return list;
		
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

ns.RoomDB.prototype.assignWorkgroup = async function( fWgId, setById, roomId ) {
	const self = this;
	roomId = roomId || self.id;
	if ( !roomId || !fWgId || !setById ) {
		roomLog( 'assingWorkgroup - invalid args', {
			rid   : roomId,
			fWgId : fWgId,
			sid   : setById,
		});
		return null;
	}
	
	const values = [
		roomId,
		fWgId,
		setById,
	];
	let res = null;
	try {
		res = await self.query( 'room_assign_workgroup', values );
	} catch( e ) {
		roomLog( 'assignWorkgroup - query err', e );
		return null;
	}
	
	if ( !res )
		return null;
	
	return res[ 0 ];
}

ns.RoomDB.prototype.dismissWorkgroup = async function( fWgId, roomId ) {
	const self = this;
	roomId = roomId || self.id;
	if ( !fWgId || !roomId ) {
		roomLog( 'dismissWorkgroup - invalid args', {
			roomId : roomId,
			fWgId  : fWgId,
		});
		return null;
	}
	
	const values = [
		roomId,
		fWgId,
	];
	let res = null;
	try {
		res = await self.query( 'room_dismiss_workgroup', values )
	} catch( e ) {
		roomLog( 'dismissWorkgroup - query err', e );
		return null;
	}
	
	if ( !res )
		return null;
	
	return res[ 0 ];
}

ns.RoomDB.prototype.getAssignedTo = async function( worgId ) {
	const self = this;
	const values = [ worgId ];
	let res = null;
	try {
		res = await self.query( 'room_get_assigned_to', values );
	} catch( err ) {
		roomLog( 'getAssignedTo - query err', err );
		return null;
	}
	
	if ( !res || !res.length )
		return [];
	
	return res.map( row => row.roomId );
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
		return null;
	}
	
	if ( !res )
		return null;
	
	return self.rowsToRelation( res );
}

ns.RoomDB.prototype.getRelationFor = async function( accId, contactId ) {
	const self = this;
	const both = await self.getRelation( accId, contactId );
	if ( null == both )
		return null;
	
	const relation = both[ accId ];
	return relation;
}

ns.RoomDB.prototype.getRelationsFor = async function( accId, includeDisabled ) {
	const self = this;
	const values = [
		accId,
		!!includeDisabled,
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

ns.RoomDB.prototype.getRelationListFor = async function( accId, includeDisabled ) {
	const self = this;
	let res = null;
	try {
		res = await self.getRelationsFor( accId, includeDisabled );
	} catch( ex ) {
		return [];
	}
	
	if ( null == res )
		return [];
	
	const list = res.map( rel => {
		return rel.contactId;
	});
	
	return list;
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

ns.RoomDB.prototype.check = async function( accountId, roomId ) {
	const self = this;
	roomId = roomId || self.id;
	let values = [
		roomId,
		accountId,
	];
	
	let res = null;
	try {
		res = await self.query( 'auth_check', values );
	} catch ( e ) {
		roomLog( 'check - qery err' );
		return null;
	}
	
	return true;
}

ns.RoomDB.prototype.revoke = function( roomId, accountId ) {
	const self = this;
	const values = [
		roomId,
		accountId,
	];
	return self.query( 'auth_remove', values );
}


ns.RoomDB.prototype.setForWorkgroup = async function(
	worgId,
	worgName,
	settings,
) {
	const self = this;
	const clientId = uuid.get( 'worg' );
	settings = settings || '{}';
	const values = [
		clientId,
		worgId,
		worgName,
		'system',
		settings,
	];
	let res = null;
	try {
		res = await self.query( 'room_create_for_workgroup', values );
	} catch( err ) {
		roomLog( 'setForWorkgroup - query err', err );
		return null;
	}
	
	return res[ 0 ] || null;
}

ns.RoomDB.prototype.getForWorkgroup = async function( worgId ) {
	const self = this;
	const values = [ worgId ];
	let res = null;
	try {
		res = await self.query( 'room_get_for_workgroup', values );
	} catch( err ) {
		roomLog( 'getForWorkgroup - query err', err );
		return null;
	}
	
	return res[ 0 ] || null;
}

ns.RoomDB.prototype.getSettings = async function( roomId ) {
	const self = this;
	roomId = roomId || self.id;
	const settings = await self.settings.getSettings( roomId );
	return settings;
}

ns.RoomDB.prototype.setSetting = async function( key, value, roomId ) {
	const self = this;
	roomId = roomId || self.id;
	return await self.settings.setSetting( roomId, key, value );
	
}

ns.RoomDB.prototype.removeSetting = async function( key, roomId ) {
	const self = this;
	roomId = roomId || self.id;
	return await self.settings.removeSetting( roomId, key );
}


// Pirvate

ns.RoomDB.prototype.init = function() {
	const self = this;
	self.settings = new ns.ISettings( self, 'room' );
	
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
	
	let res = null;
	try {
		await self.query( 'message_set', values );
	} catch( e ) {
		msgLog( 'set - query boop', e );
		return null;
	}
	
	return conf.msgId;
}

ns.MessageDB.prototype.setWork = async function( conf ) {
	const self = this;
	let msgId = null;
	try {
		msgId = await self.set( conf );
	} catch( err ) {
		msgLog( 'setWork - set msg failed', err );
		return null;
	}
	
	if ( !msgId ) {
		msgLog( 'setWork - msg did not return a msgId', msgId );
		return null;
	}
	
	const targets = conf.targets;
	const source = conf.source;
	const tIds = Object.keys( targets );
	const rows = [];
	tIds.forEach( addRows );
	await Promise.all( rows.map( setTarget ));
	
	return msgId;
	
	function addRows( tId ) {
		const wT = targets[ tId ];
		if ( null == wT.length ) {
			// set room target
			const room = [
				msgId,
				source,
				tId,
				null,
			];
			rows.push( room );
		}
		else {
			// set room user targets
			wT.forEach( t => {
				const member = [
					msgId,
					source,
					tId,
					t,
				];
				rows.push( member );
			});
		}
	}
	
	async function setTarget( values ) {
		try {
			await self.query( 'message_set_work_target', values );
		} catch( err ) {
			msgLog( 'setTarget - failed', {
				row : values,
				err : err,
			});
		}
	}
	
}

ns.MessageDB.prototype.setForRelation = async function(
	msg,
	relationId,
	toId,
) {
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
		msg.fromId,
		toId,
		msg.time,
	];
	try {
		await self.query( 'user_relation_update_messages', values );
	} catch ( err ) {
		msgLog( 'setForRelation, update relation - query failed', err );
		return false;
	}
	
	return true;
}

ns.MessageDB.prototype.getRelations = async function( relationId ) {
	const self = this;
	const values = [ relationId ];
	let res;
	try {
		res = await self.query( 'user_relation_messages', values );
	} catch( ex ) {
		msgLog( 'getRelations - query ex', ex );
		return null;
	}
	
	const relations = res[ 0 ][ 0 ];
	const rels = res[ 1 ];
	const userA = rels[ 0 ];
	const userB = rels[ 1 ];
	relations[ userA.userId ] = userA;
	relations[ userB.userId ] = userB;
	return relations;
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
		lastMessage    : lastMessageRes ? lastMessageRes[ 0 ] : null,
	};
}

ns.MessageDB.prototype.updateUserLastRead = async function( relationId, userId, msgId ) {
	const self = this;
	const timestamp = Date.now();
	const values = [
		relationId,
		userId,
		msgId,
		timestamp,
	];
	let res = null;
	try {
		res = await self.query( 'user_relation_update_last_read', values );
	} catch( err ) {
		msgLog( 'updateUserLastRead - db err', err );
		return false;
	}
	
	if ( !res )
		return null;
	
	return res[ 0 ] || null;
}

ns.MessageDB.prototype.setRoomUserMessages = async function( userId, roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		roomId,
		userId,
	];
	let res = null;
	try {
		res = await self.query( 'room_user_messages_set', values );
	} catch( e ) {
		msgLog( 'setRoomUserMessages - query err', e );
		return null;
	}
	return res[ 0 ];
}

ns.MessageDB.prototype.loadRoomUserMessages = async function( roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		roomId,
	];
	let res = null;
	try {
		res = await self.query( 'room_user_messages_load', values );
	} catch( e ) {
		msgLog( 'loadRoomUserMessages - query fail', {
			values : values,
			e      : e,
		}, 3 );
		return null;
	}
	
	return res;
}

ns.MessageDB.prototype.updateRoomUserMessages = async function( msgId, userList, roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const usersStr = userList.join( '|' );
	const values = [
		roomId,
		usersStr,
		msgId,
	];
	let res = null;
	try {
		res = await self.query( 'room_user_messages_update', values );
	} catch( e ) {
		msgLog( 'updateRoomUserMessages - query boop', e );
		return false;
	}
	
	return true;
}

ns.MessageDB.prototype.getRoomUserMessagesUnread = async function( userId, roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		roomId,
		userId,
	];
	
	let res = null;
	try {
		res = await self.query( 'room_user_messages_count_unread', values );
	} catch( e ) {
		msgLog( 'getRoomUserMessagesUnread - query fail', e );
		return false;
	}
	
	const row = res[ 0 ];
	if ( !row )
		return null;
	
	return row.unread;
}

// worgId is optional, enables counting messages to/from work rooms
ns.MessageDB.prototype.getRoomUserMessagesUnreadWorg = async function(
	userId,
	worgId,
	noPrivate,
	userIsViewer,
	roomId
) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		roomId,
		userId,
		worgId,
		noPrivate,
		userIsViewer,
	];
	
	let res = null;
	try {
		res = await self.query( 'room_user_messages_count_unread_worg', values );
	} catch( e ) {
		msgLog( 'getRoomUserMessagesUnreadWorg - query fail', e );
		return false;
	}
	
	const row = res[ 0 ];
	if ( !row )
		return null;
	
	return row.unread;
}

ns.MessageDB.prototype.get = async function( eventId ) {
	const self = this;
	if ( !eventId )
		throw new Error( 'ERR_INVALID_ARGS' );
		
	const values = [
		eventId,
	];
	const rows = await self.query( 'message_get_by_id', values );
	const events = self.parseItems( rows );
	return events[ 0 ];
}

ns.MessageDB.prototype.getBefore = async function( 
	beforeTime, 
	length, 
	workgroup, 
	includeDeleted 
) {
	const self = this;
	beforeTime = beforeTime || Date.now();
	length = length || 30;
	includeDeleted = !!includeDeleted;
	const values = [
		self.roomId,
		beforeTime,
		length,
		includeDeleted
	];
	
	let msgRows = await self.query( 'message_get_before', values );
	let workMessages = null;
	if ( workgroup ) {
		if ( 1 )
			workMessages = await self.getWorkMessagesBefore(
				workgroup,
				beforeTime,
				( length - msgRows.length )
			);
		else {
			const first = msgRows[ 0 ];
			const last = msgRows[ msgRows.length -1 ];
			workMessages = await self.getWorkMessagesBetween( workgroup, first.time, last.time );
		}
		
		msgRows = self.replaceWithWork( msgRows, workMessages );
	}
	
	return self.parseItems( msgRows );
}

ns.MessageDB.prototype.getAfter = async function( 
	afterTime, 
	length, 
	workgroup, 
	includeDeleted 
) {
	const self = this;
	afterTime = afterTime || Date.now();
	length = length || 30;
	includeDeleted = !!includeDeleted;
	const values = [
		self.roomId,
		afterTime,
		length,
		includeDeleted,
	];
	
	let msgRows = await self.query( 'message_get_after', values );
	let workMessages = null;
	if ( workgroup ) {
		if ( 1 )
			workMessages = await self.getWorkMessagesAfter(
				workgroup,
				afterTime,
				( length - msgRows.length )
			);
		else {
			const first = msgRows[ 0 ];
			const last = msgRows[ msgRows.length -1 ];
			workMessages = await self.getWorkMessagesBetween( workgroup, first.time, last.time );
		}
		
		msgRows = self.replaceWithWork( msgRows, workMessages );
	}
	
	return self.parseItems( msgRows );
}

ns.MessageDB.prototype.getForView = async function(
	worgId,
	userId,
	beforeTime,
	afterTime,
	length
) {
	const self = this;
	length = length || 5;
	const values = [
		worgId,
		userId,
		beforeTime || null,
		afterTime || null,
		length,
	];
	let res = null;
	res = await self.query( 'message_get_for_view', values );
	if ( !res )
		return null;
	
	const msgRows = res[ 0 ];
	const targetRows = res[ 1 ];
	if ( !msgRows || !targetRows ) {
		msgLog( 'getForView - missing rows', {
			msgRows    : msgRows,
			targetRows : targetRows,
		}, 3 );
		return null;
	}
	
	const items = self.rebuildWorkMsgTargets( msgRows, targetRows );
	return self.parseItems( items );
}

ns.MessageDB.prototype.getAfterView = async function(
	afterTime,
	length,
	worgId,
	userId
) {
	const self = this;
	return null;
}

ns.MessageDB.prototype.getWithTargets = async function( eventId ) {
	const self = this;
	if ( !eventId )
		return;
	
	const values = [
		eventId,
	];
	
	let res = null;
	try {
		res = await self.query( 'message_get_with_work_targets', values );
	} catch( e ) {
		msgLog( 'getWithTargets - query ex', {
			e : e,
			values : values,
		}, 3 );
		return null;
	}
	
	if ( !res || !res.length )
		return null;
	
	const msgs = res[ 0 ];
	if ( !msgs || !msgs.length )
		return null;
	
	let msg = msgs[ 0 ];
	const targets = res[ 1 ];
	if ( !targets || !targets.length ) {
		const items = self.parseItems([ msg ]);
		return items[ 0 ];
	}
	
	msg.targets = {};
	targets.forEach( t => {
		const tId = t.target;
		msg.source = t.source;
		if ( !msg.targets[ tId ])
			msg.targets[ tId ] = true;
		
		if ( !t.memberId )
			return;
		
		let target = msg.targets[ tId ];
		if ( null == target.length )
			target = [];
		
		target.push( t.memberId );
		msg.targets[ tId ] = target;
	});
	
	const items = self.parseItems([ msg ]);
	return items[ 0 ];
}

ns.MessageDB.prototype.getWorkMessagesBefore = function( workgroup, before, length ) {
	const self = this;
	const query = 'message_get_work_targets_before';
	const values = [
		workgroup,
		before,
		length || 30,
	];
	return self.getWorkMessages( query, values );
}

ns.MessageDB.prototype.getWorkMessagesAfter = function( workgroup, after, length ) {
	const self = this;
	const query = 'message_get_work_targets_after';
	const values = [
		workgroup,
		after,
		length || 30,
	];
	return self.getWorkMessages( query, values );
}

ns.MessageDB.prototype.getWorkMessagesBetween = function( workgroup, from, to ) {
	const self = this;
	const query = 'message_get_work_targets_between';
	const values = [
		workgroup,
		from,
		to,
	];
	return self.getWorkMessages( query, values );
}

ns.MessageDB.prototype.getWorkMessages = async function( query, values ) {
	const self = this;
	let rows = null;
	try {
		rows = await self.query( query, values );
	} catch( err ) {
		msgLog( 'getWorkMessageTargets - query fail', {
			query  : query,
			values : values,
			err    : err,
		}, 3 );
		return null;
	}
	
	const messages = rows[ 0 ];
	const targets = rows[ 1 ];
	
	const items = self.rebuildWorkMsgTargets( messages, targets );
	return items;
}

ns.MessageDB.prototype.rebuildWorkMsgTargets = function( msgRows, targetRows ) {
	const self = this;
	const msgTargetMap = buildTargets( targetRows );
	msgRows.forEach( msg => {
		let mId = msg.msgId;
		let targets = msgTargetMap[ mId ];
		if ( !targets )
			return;
		
		msg.source = targets.source;
		msg.targets = targets;
		delete targets.source;
	});
	
	return msgRows;
	
	function buildTargets( targets ) {
		const msgTargetMap = {};
		targets.forEach( tRow => {
			const mId = tRow.msgId;
			const source = tRow.source;
			if ( !msgTargetMap[ mId ]) {
				msgTargetMap[ mId ] = {};
				msgTargetMap[ mId ].source = source;
			}
			
			const mTargets = msgTargetMap[ mId ];
			if ( !tRow.memberId )
				setRoomTarget( mTargets, tRow );
			else
				setMemberTarget( mTargets, tRow );
		});
		
		return msgTargetMap;
		
		function setRoomTarget( msgTargets, tRow ) {
			let tWG = tRow.target;
			msgTargets[ tWG ] = true;
		}
		
		function setMemberTarget( msgTargets, tRow ) {
			let tWG = tRow.target;
			let tArr = msgTargets[ tWG ] || []; // array of member targets
			tArr.push( tRow.memberId );
			msgTargets[ tWG ] = tArr;
		}
	}
}

ns.MessageDB.prototype.update = async function(
	eventId,
	message,
) {
	const self = this;
	const values = [
		eventId,
		message,
	];
	let res = null;
	try {
		res = await self.query( 'message_update', values );
	} catch ( e ) {
		msgLog( 'err', e );
		return e;
	}
	
	if ( !res || !res.length )
		return null;
	
	return res[ 0 ] || null;
}

ns.MessageDB.prototype.setEdit = async function(
	msgId,
	editBy,
	reason,
	message,
) {
	const self = this;
	const editTime = Date.now(); // let db procedure set this
	const clientId = uuid.get( 'edit' );
	const values = [
		clientId,
		msgId,
		editBy,
		editTime,
		reason,
		message,
	];
	let res = null;
	try {
		res = await self.query( 'message_set_edit', values );
	} catch( e ) {
		msgLog( 'setEdit - values', values );
		msgLog( 'setEdit - query err', e.stack || e );
		return null;
	}
	
	if ( !res )
		return null;
	
	return res[ 0 ];
}

ns.MessageDB.prototype.validMessageStatus = [
	'moderate',
	'validate',
	'delete',
	'edit',
	'pin',
]

ns.MessageDB.prototype.setStatus = async function( 
	status,
	eventId,
	setBy,
	reason,
	message
) {
	const self = this;
	const valid = self.validMessageStatus.some( v => v === status );
	if ( !valid )
		throw 'ERR_INVALID_STATUS';
	
	if (( null == eventId ) || ( null == setBy ))
		throw 'ERR_MISSING_ARGS';
	
	reason = reason || null;
	message = message || null;
	const setTime = Date.now();
	const statusId = uuid.get( status );
	const values = [
		status,
		statusId,
		eventId,
		setBy,
		setTime,
		reason,
		message,
	];
	
	let res = null;
	try {
		res = await self.query( 'message_set_status', values );
	} catch( ex ) {
		msgLog( 'setStatus query ex', ex );
		return false;
	}
	
	const msg = res[ 0 ];
	if ( null == msg )
		return false;
	
	const event = {
		type : msg.type,
		data : msg,
	};
	return event;
}

// Private

ns.MessageDB.prototype.init = function() {
	const self = this;
	
}

ns.MessageDB.prototype.parseItems = function( items ) {
	const self = this;
	if ( !items || !items.length )
		return null;
	
	const events = items.map( toTypeData );
	return events;
	
	function toTypeData( item ) {
		const event = {
			type : item.type,
			data : null,
		};
		
		event.data = item;
		return event;
	}
}

ns.MessageDB.prototype.replaceWithWork = function( msgRows, workRows ) {
	const self = this;
	if ( !workRows || !workRows.length )
		return msgRows;
	
	msgRows = msgRows.filter( item => {
		const mId = item.msgId;
		return !workRows.some( workItem => workItem.msgId === mId );
	});
	
	let log = [ ...msgRows, ...workRows ];
	log.sort(( a, b ) => {
		if ( a.time < b.time )
			return -1
		else
			return 1;
	});
	
	return log;
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

ns.InviteDB.prototype.set = function(
	type,
	token,
	targetId,
	createdBy,
	singleUse,
	roomId
) {
	const self = this;
	roomId = roomId || self.roomId;
	singleUse = !!singleUse;
	const values = [
		type,
		token,
		roomId,
		singleUse,
		targetId,
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

ns.InviteDB.prototype.checkExists = async function( targetId, roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		targetId,
		roomId,
	];
	
	let res = null;
	try {
		res = await self.query( 'invite_check_exists', values );
	} catch( ex ) {
		invLog( 'check - query ex', ex )
		return true;
	}
	
	const row = res[ 0 ];
	return !!row;
}

// currently only loads public tokens
ns.InviteDB.prototype.getForRoom = async function( roomId ) {
	const self = this;
	roomId = roomId || self.roomId;
	const values = [
		roomId,
	];
	
	let res = null;
	try {
		res = await self.query( 'invite_get_room', values );
	} catch( ex ) {
		invLog( 'getForRoom - query ex', ex );
		return null;
	}
	
	return res;
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

ns.InviteDB.prototype.getForUser = async function( targetId ) {
	const self = this;
	const values = [ targetId ];
	let res = null;
	try {
		res = await self.query( 'invite_get_target', values );
	} catch( ex ) {
		invLog( 'getForUser - query fail', ex );
	}
	
	if ( null == res )
		return null;
	
	return res.map( inv => {
		const invite = {
			type      : inv.type,
			token     : inv.token,
			roomId    : inv.roomId,
			targetId  : inv.targetId,
			createdBy : inv.createdBy,
			created   : inv.created,
		};
		return invite;
	});
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


// Interface Settings

ns.ISettings = function( db, table ) {
	const self = this;
	//iSLog( 'yep', [ db, table ]);
	self.db = db;
	self.table = table;
	
	self.init();
}

// Public

ns.ISettings.prototype.close = function() {
	const self = this;
	delete self.db;
	delete self.prefix;
}

ns.ISettings.prototype.getSettings = async function( clientId ) {
	const self = this;
	const values = [ clientId ];
	let res = null;
	const fun = self.table + '_settings_get';
	try {
		res = await self.db.query( fun, values );
	} catch( ex ) {
		iSLog( 'getSettings - query ex', ex );
		return null;
	}
	
	if ( null == res )
		return null;
	
	let obj = res[ 0 ];
	if ( !obj || !obj.settings ) {
		iSLog( 'getSettings - no settings', res );
		return null;
	}
	
	if ( 'string' !== typeof( obj.settings ))
		return obj.settings;
	
	let settings = null
	try {
		settings = JSON.parse( obj.settings );
	} catch( e ) {
		iSLog( 'getSettings - invalid JSON', obj.settings );
		throw new Error( 'ERR_INVALID_JSON' );
	}
	
	return settings;
}

ns.ISettings.prototype.getSetting = function( clientId, key ) {
	const self = this;
	iSLog( 'getSetting NYI', [ key, clientId ]);
	throw new Error( 'ERR_NYI' );
}

ns.ISettings.prototype.setSetting = function( clientId, key, value ) {
	const self = this;
	let obj = {};
	obj[ key ] = value;
	let jsonStr = JSON.stringify( obj );
	const values = [
		clientId,
		key,
		jsonStr,
	];
	
	const fun = self.table + '_settings_set_key_value';
	return self.db.query( fun, values );
}

ns.ISettings.prototype.removeSetting = function( clientId, key ) {
	const self = this;
	const values = [
		clientId,
		key,
	];
	
	const fun = self.table + '_settings_remove_key';
	return self.db.query( fun, values );
}

// Private

ns.ISettings.prototype.init = function() {
	const self = this;
}



module.exports = ns;
