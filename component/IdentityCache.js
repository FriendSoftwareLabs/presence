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
	self.timeout = 1000 * 60 * 60 * 36;
	
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

ns.IDC.prototype.get = async function( id ) {
	const self = this;
	let identity = self.IDs[ id ];
	if ( identity ) {
		self.touch( id );
		return identity;
	}
	
	identity = await self.load( id );
	return identity;
}

// Private

ns.IDC.prototype.init = function( dbPool ) {
	const self = this;
	self.accDB = new dFace.AccountDB( dbPool );
	// trim every 24 hours
	self.trim = setInterval( trims, self.timeout );
	function trims() {
		self.trimIds();
	}
}

ns.IDC.prototype.trimIds = function() {
	const self = this;
	let old = Date.now() - self.timeout;
	let ids = Object.keys( self.IDs );
	ids.forEach( id => {
		let accessTime = self.lastAccess[ id ];
		if ( accessTime > old )
			return;
		
		delete self.IDs[ id ];
		delete self.lastAccess[ id ];
	});
}

ns.IDC.prototype.load = async function( id ) {
	const self = this;
	let dbId = null;
	try {
		dbId = await self.accDB.getById( id );
	} catch( e ) {
		log( 'load - db error', e );
	}
	
	if ( !dbId )
		return null;
	
	let avatar = dbId.avatar;
	if ( !avatar )
		avatar = await tinyAvatar.generate( dbId.name );
	
	let identity = {
		clientId : dbId.clientId,
		name     : dbId.name,
		avatar   : avatar,
	};
	self.IDs[ id ] = identity;
	self.touch( id );
	return identity;
}

ns.IDC.prototype.touch = function( id ) {
	const self = this;
	self.lastAccess[ id ] = Date.now();
}

module.exports = ns.IDC;
