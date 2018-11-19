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

const log = require( './Log' )( 'IDC' );
const uuid = require( './UuidPrefix' )( 'msg' );
const Emitter = require( './Events' ).Emitter;
const tinyAvatar = require( './TinyAvatar' );
const dFace = require( './DFace' );

const util = require( 'util' );

var ns = {};

ns.IDC = function( dbPool ) {
	const self = this;
	log( 'hi!' );
	self.IDs = {};
	self.lastAccess = {};
	self.TIMEOUT = 1000 * 60 * 60 * 36;
	self.accDB = null;
	
	self.init( dbPool );
}

// Public

ns.IDC.prototype.close = function() {
	const self = this;
	if ( null != self.trim ) {
		clearInterval( self.trim );
		self.trim = null;
	}
	
	if ( self.accDB )
		self.accDB.close();
	
	delete self.accDB;
	delete self.lastAccess;
	delete self.IDs;
}

ns.IDC.prototype.set = async function( fcId ) {
	const self = this;
}


ns.IDC.prototype.get = async function( id ) {
	const self = this;
	if ( !id ) {
		try {
			throw new Error( 'ERR_NO_ID' );
		} catch( err ) {
			log( 'IDC.get - missing id', err.stack || err );
		}
	}
	let identity = self.IDs[ id ];
	if ( identity ) {
		self.touch( id );
		return identity;
	}
	
	identity = await self.load( id );
	return identity;
}

ns.IDC.prototype.getList = async function( idList ) {
	const self = this;
	let identities = await Promise.all( idList.map( await get ));
	if ( !identities || !identities.length )
		return [];
	
	return identities;
	
	async function get( id ) {
		let identity = await self.get( id );
		return identity;
	}
}

ns.IDC.prototype.update = async function( identity ) {
	const self = this;
	const cId = identity.clientId;
	const cache = await self.get( cId );
	cache.isAdmin = !!identity.isAdmin;
	cache.isGuest = !!identity.isGuest;
	await self.checkName( identity, cache );
	await self.checkAvatar( identity, cache );
	//self.checkEmail( identity, cache );
	return cache;
}

ns.IDC.prototype.setOnline = function( clientId, isOnline ) {
	const self = this;
	const id = self.IDs[ clientId ];
	if ( !id )
		return;
	
	id.isOnline = isOnline;
}

ns.IDC.prototype.addGuest = function( id ) {
	const self = this;
	id.avatar = null;
	id.isGuest = true;
	self.add( id );
	return id;
}

// Private

ns.IDC.prototype.init = function( dbPool ) {
	const self = this;
	self.accDB = new dFace.AccountDB( dbPool );
	// trim every 24 hours
	self.trim = setInterval( trims, self.TIMEOUT );
	function trims() {
		self.trimIds();
	}
}

ns.IDC.prototype.trimIds = function() {
	const self = this;
	let old = Date.now() - self.TIMEOUT;
	let ids = Object.keys( self.IDs );
	ids.forEach( id => {
		let accessTime = self.lastAccess[ id ];
		if ( accessTime > old )
			return;
		
		delete self.IDs[ id ];
		delete self.lastAccess[ id ];
	});
}

ns.IDC.prototype.load = async function( cId ) {
	const self = this;
	let dbId = null;
	try {
		dbId = await self.accDB.getById( cId );
	} catch( e ) {
		log( 'load - db error', e );
	}
	
	if ( !dbId )
		return null;
	
	let identity = {
		clientId    : dbId.clientId,
		name        : dbId.name,
		avatar      : dbId.avatar,
		isAdmin     : null,
		isOnline    : false,
	};
	self.add( identity );
	if ( !identity.avatar )
		await self.setPixelAvatar( cId );
	
	return identity;
}

ns.IDC.prototype.add = function( id ) {
	const self = this;
	const cId = id.clientId;
	self.IDs[ cId ] = id;
	self.touch( cId );
}

ns.IDC.prototype.touch = function( id ) {
	const self = this;
	self.lastAccess[ id ] = Date.now();
}

ns.IDC.prototype.checkName = async function( id, c ) {
	const self = this;
	if ( id.name === c.name )
		return true;
	
	const cId = c.clientId;
	const name = id.name;
	await self.accDB.updateName( cId, name );
	c.name = name;
	
	await self.updateAvatar( cId );
	/* 
	self.emit( 'name', {
		clientId : cId,
		name     : name,
	});
	*/
	return true;
}

ns.IDC.prototype.checkAvatar = async function( id, c ) {
	const self = this;
	if ( !id.avatar )
		return false;
	
	if ( id.avatar === c.avatar )
		return false;
	
	const avatar = await self.updateAvatar( id.clientId, id.avatar );
	return avatar;
}

ns.IDC.prototype.updateAvatar = async function( clientId, avatar ) {
	const self = this;
	const dbId = await self.accDB.getById( clientId );
	if ( !dbId )
		return null;
	
	if ( !avatar && !dbId.avatar )
		return await self.setPixelAvatar( clientId );
	
	if ( !avatar )
		return null;
	
	// TODO preprocessing of avatar goes here
	
	await self.accDB.updateAvatar( clientId, avatar );
	const cacheId = await self.get( clientId );
	cacheId.avatar = avatar;
	return avatar;
}

ns.IDC.prototype.setPixelAvatar = async function( clientId ) {
	const self = this;
	const cacheId = await self.get( clientId );
	const pixels = await tinyAvatar.generate( cacheId.name );
	cacheId.avatar = pixels;
	return pixels;
}

ns.IDC.prototype.checkEmail = async function( id, c ) {
	const self = this;
	log( 'checkEmail - NYI', id );
	return true;
}

module.exports = ns.IDC;
