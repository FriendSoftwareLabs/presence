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

const log = require( './Log' )( 'GuestAccount' );
const Account = require( './Account' );
const util = require( 'util' );

/*
	GUESTACCOUNT CONSTRUCTOR RETURNS A PROMISE
	dealwithit.jpg
*/
const ns = {};
ns.GuestAccount = function(
		session,
		clientId,
		roomId,
		idCache,
		roomCtrl,
		worgCtrl
	) {
	const self = this;
	self.roomId = roomId;
	return new Promise(( resolve, reject ) => {
		Account.call( self,
			session,
			clientId,
			null,
			idCache,
			roomCtrl,
			worgCtrl
		)
			.then( accReady )
			.catch( accFail );
		
		function accReady( res ) {
			resolve( self );
		}
		
		function accFail( err ) {
			log( 'GuestAccount - accFail', err );
			resolve( null );
		}
	});
}

util.inherits( ns.GuestAccount, Account );

// Public

ns.GuestAccount.prototype.accClose = Account.prototype.close;
ns.GuestAccount.prototype.close = function() {
	const self = this;
	self.accClose();
}

ns.GuestAccount.prototype.getWorkgroups = function() {
	const self = this;
	return [];
}

// private

ns.GuestAccount.prototype.init = async function() {
	const self = this;
	await self.setIdentity();
	self.setLogger();
	self.bindRoomCtrl();
	self.bindContactEvents();
	self.bindConn();
	self.bindIdRequests();
	self.setupRooms();
	
	return true;
}

ns.GuestAccount.prototype.setLogger = function() {
	const self = this;
	const logStr = 'GuestAccount-' + self.identity.name;
	self.log = require( './Log' )( logStr );
}

ns.GuestAccount.prototype.initializeClient = async function( event, clientId ) {
	const self = this;
	const state = {
		type : 'initialize',
		data : {
			account  : {
				host     : global.config.shared.wsHost,
				clientId : self.id,
				name     : self.identity.name,
				isGuest  : self.isGuest,
			},
			rooms    : [],
			contacts : [],
		},
	};
	
	self.conn.send( state, clientId );
	const room = await self.roomCtrl.guestJoinRoom( self.id, self.roomId );
	if ( !room )
		return;
	
	self.joinedARoomHooray( room );
}

module.exports = ns.GuestAccount;
