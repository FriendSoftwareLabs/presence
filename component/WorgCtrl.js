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

const log = require( './Log' )( 'WorgCtrl' );
const events = require( './Events' );
const FService = require( '../api/FService' );
const dFace = require( './DFace' );
const util = require( 'util' );
const ns =  {};

ns.WorgCtrl = function( dbPool, idCache ) {
	const self = this;
	events.Emitter.call( self );
	
	self.idc = idCache;
	self.db = null;
	
	self.fMap = {}; // fId to worg mapping
	self.cMap = {}; // clientId to worg mapping
	self.fIds = [];
	self.cIds = [];
	self.worgUsers = {}; // each workgroup has a list of members.
	self.userWorgs = {}; // each user has a list of memberships.
	self.streamers = {}; // each streamer has a list of streamWorgs
	self.streamWorgs = []; // worg ids for streaming
	self.superIds = []; // super group client ids
	self.superChildren = {};
	
	self.init( dbPool );
}

util.inherits( ns.WorgCtrl, events.Emitter );

// Public

ns.WorgCtrl.prototype.add = function( worg ) {
	const self = this;
	if ( !worg.fId ) {
		log( 'add - invalid worg', worg );
		return null;
	}
	
	if ( !worg.clientId )
		worg = self.setClientId( worg );
	
	let fId = worg.fId;
	let cId = worg.clientId;
	if ( self.cMap[ cId ]) {
		self.checkParent( worg );
		return null;
	}
	
	self.fMap[ fId ] = worg;
	self.cMap[ cId ] = worg;
	self.fIds.push( fId );
	self.cIds.push( cId );
	self.worgUsers[ cId ] = [];
	if ( worg.parentId )
		self.setSuperChild( worg.clientId );
	
	self.emit( 'added', {
		fId      : fId,
		clientId : cId,
	});
	
	return cId;
}

ns.WorgCtrl.prototype.update = function( serviceWorgs ) {
	const self = this;
	if ( !serviceWorgs || !serviceWorgs.length )
		return;
	
	serviceWorgs.forEach( add );
	async function add( swg ) {
		if ( !swg )
			return;
		
		const fUsers = swg.userids;
		const worg = self.normalizeServiceWorg( swg );
		const wId = worg.clientId;
		self.add( worg );
		
		let uIds = null;
		if ( fUsers && fUsers.length )
			uIds = await self.getUIdsForFUsers( fUsers );
		
		if ( uIds && uIds.length )
			self.addUsers( wId, uIds );
	}
}

ns.WorgCtrl.prototype.get = function( clientId ) {
	const self = this;
	if ( clientId )
		return self.cMap[ clientId ] || null;
	
	return self.cMap;
}

ns.WorgCtrl.prototype.getList = function() {
	const self = this;
	return self.cIds;
}

ns.WorgCtrl.prototype.resolveList = function( worgIds ) {
	const self = this;
	const worgs = {};
	worgIds.forEach( wId => {
		worgs[ wId ] = self.cMap[ wId ];
	});
	return worgs;
}

ns.WorgCtrl.prototype.remove = function( worgId ) {
	const self = this;
	const  worg = self.get( worgId );
	if ( !worg )
		return;
	
	if ( worg.parentId )
		self.removeSuperChild( worgId );
	
	self.emit( 'removed', worg );
	const fId = worg.fId;
	const wId = worg.clientId;
	const members = self.worgUsers[ wId ];
	self.removeUsers( wId, members );
	self.sendRegenerate( members );
	
	delete self.worgUsers[ wId ];
	delete self.fMap[ fId ];
	delete self.cMap[ wId ];
}

ns.WorgCtrl.prototype.getByFId = function( fId ) {
	const self = this;
	if ( fId )
		return self.fMap[ fId ] || null;
	
	return self.fMap;
}

ns.WorgCtrl.prototype.getByFIdList = function( fIdList ) {
	const self = this;
}

ns.WorgCtrl.prototype.removeByFID = function( fId ) {
	const self = this;
	log( 'removeByFID - NYI', fId );
}

ns.WorgCtrl.prototype.cIdToFId = function( cId ) {
	const self = this;
	const worg = self.cMap[ cId ];
	if ( !worg )
		return null;
	
	return worg.fId;
}

ns.WorgCtrl.prototype.fIdToCId = function( fId ) {
	const self = this;
	const worg = self.fMap[ fId ];
	if ( !worg )
		return null;
	
	return worg.clientId;
}

ns.WorgCtrl.prototype.addUser = function( accId, worgs ) {
	const self = this;
	addNewWorgs( worgs );
	addSupers( worgs.supergroups );
	registerUser( accId, worgs );
	
	function addNewWorgs( worgs ) {
		if ( worgs.available )
			self.updateAvailable( worgs.available );
		else {
			if ( worgs.member && worgs.member.length )
				worgs.member.forEach( worg => self.add( worg ));
		}
	}
	
	function addSupers( superIds ) {
		if ( !superIds || !superIds.length )
			return;
		
		self.setSuperGroups( superIds );
	}
	
	function registerUser( accId, worgs ) {
		if ( worgs.member )
			self.updateUserWorgs( accId, worgs.member );
		
		if ( worgs.stream )
			self.updateStreamWorgs( accId, worgs.stream );
	}
}

ns.WorgCtrl.prototype.getUserList = function( worgId ) {
	const self = this;
	return self.worgUsers[ worgId ] || [];
}

ns.WorgCtrl.prototype.getMemberOf = function( accId ) {
	const self = this;
	return self.userWorgs[ accId ] || [];
}

ns.WorgCtrl.prototype.getMemberOfAsFID = function( accId ) {
	const self = this;
	const cId_list = self.getMemberOf( accId );
	return self.cId_to_fId_list( cId_list );
}

ns.WorgCtrl.prototype.getContactList = function( accId ) {
	const self = this;
	const member = self.getMemberOf( accId );
	const allLists = member.map( getWorgUserList );
	const flatted = {};
	allLists.forEach( flatten );
	const list = Object.keys( flatted );
	return list;
	
	function getWorgUserList( wId ) {
		let list = self.getUserList( wId );
		return list;
	}
	
	function flatten( list ) {
		list.forEach( accId => {
			flatted[ accId ] = true;
		});
	}
}

ns.WorgCtrl.prototype.removeUser = function( userId ) {
	const self = this;
	let memberOf = self.userWorgs[ userId ];
	if ( !memberOf || !memberOf.length )
		return;
	
	delete self.userWorgs[ userId ];
	delete self.streamers[ userId ];
	const affectedUIds = {};
	memberOf.forEach( removeFrom );
	const affectedList = Object.keys( affectedUIds );
	self.sendRegenerate( affectedList );
	
	function removeFrom( worgId ) {
		self.removeFromWorg( worgId, userId );
		self.sendRemovedFrom( worgId, [ userId ] );
		const members = self.worgUsers[ worgId ];
		members.forEach( uId => {
			affectedUIds[ uId ] = true;
		});
	}
}

ns.WorgCtrl.prototype.checkUserIsStreamerFor = function( accId, worgList ) {
	const self = this;
	const streamer = self.streamers[ accId ];
	if ( !streamer )
		return false;
	
	const isStreamer = streamer.some( streamerWorgId => {
		return worgList.some( listWorgId => listWorgId === streamerWorgId );
	});
	
	return isStreamer;
}

ns.WorgCtrl.prototype.removeStreamWorkgroup = function( worgId ) {
	const self = this;
	log( 'removeStreamWorkgroup - NYI', worgId );
}

ns.WorgCtrl.prototype.getAssignedForRoom = async function( roomId ) {
	const self = this;
	let dbWorgs = await self.roomDb.getAssignedWorkgroups( roomId );
	dbWorgs = dbWorgs.map( worg => {
		return self.setClientId( worg );
	});
	
	return dbWorgs;
}

ns.WorgCtrl.prototype.getSuperGroups = function() {
	const self = this;
	return self.superIds;
}

ns.WorgCtrl.prototype.getSuperGroupsFor = function( accountId ) {
	const self = this;
	let userWorgs = self.getMemberOf( accountId );
	let superWorgs = {};
	userWorgs.forEach( checkWorg );
	return Object.keys( superWorgs );
	
	function checkWorg( wId ) {
		self.superIds.forEach( sId => {
			if ( sId === wId )
				superWorgs[ sId ] = true;
			
			let scList = self.superChildren[ sId ];
			scList.forEach( cId => {
				if ( cId != wId )
					return;
				
				superWorgs[ cId ] = true;
			});
		});
	};
}

ns.WorgCtrl.prototype.getSuperParent = function( worgId ) {
	const self = this;
	let parentId = null;
	self.superIds.some( checkChildren );
	return parentId;
	
	function checkChildren( sId ) {
		const cList = self.superChildren[ sId ];
		if ( !cList.some( cId => cId === worgId ))
			return false;
		
		parentId = sId;
		return true;
	}
}

ns.WorgCtrl.prototype.getSuperChildren = function( superId ) {
	const self = this;
	return self.superChildren[ superId ] || [];
}

ns.WorgCtrl.prototype.checkIsSuper = function( worgId ) {
	const self = this;
	return !!self.superIds.some( sId => sId === worgId );
}

ns.WorgCtrl.prototype.close = function() {
	const self = this;
	if ( self.serviceConn )
		self.serviceConn.close();
	
	if ( self.roomDb )
		self.roomDb.close();
	
	delete self.service;
	delete self.roomDb;
	delete self.idc;
}

// Private

ns.WorgCtrl.prototype.init = function( dbPool ) {
	const self = this;
	self.bindService();
	log( 'WorgCtrl o7 o7 o8 o7' );
	self.roomDb = new dFace.RoomDB( dbPool );
	
}

ns.WorgCtrl.prototype.bindService = function() {
	const self = this;
	const service = new FService();
	if ( !service )
		return;
	
	self.serviceConn = new events.EventNode( 'group', service, serviceSink );
	self.serviceConn.on( 'create', e => self.handleGroupCreate( e ));
	self.serviceConn.on( 'update', e => self.handleGroupUpdate( e ));
	self.serviceConn.on( 'delete', e => self.handleGroupDelete( e ));
	self.serviceConn.on( 'addusers', e => self.handleAddUsers( e ));
	self.serviceConn.on( 'setusers', e => self.handleSetUsers( e ));
	self.serviceConn.on( 'removeusers', e => self.handleRemoveUsers( e ));
	//self.serviceConn.on( '')
	function serviceSink( ...args ) {
		log( 'serviceSink - group', args, 3 );
	}
	
}

ns.WorgCtrl.prototype.handleGroupCreate = function( swg ) {
	const self = this;
	const wg = self.normalizeServiceWorg( swg );
	self.add( wg );
}

ns.WorgCtrl.prototype.handleGroupUpdate = function( swg ) {
	const self = this;
	const uptd = self.normalizeServiceWorg( swg );
	const curr = self.get( uptd.clientId );
	if ( !curr ) {
		log( 'handleGroupUpdate - no current group to update', {
			update  : swg,
			current : self.cMap,
		}, 3 );
		return;
	}
	
	let sendUpdate = false;
	const cId = curr.clientId;
	if ( uptd.fParentId !== curr.fParentId ) {
		log( 'parent id change, handle!', {
			c : curr,
			u : uptd,
		});
		if ( curr.parentId )
			self.removeSuperChild( cId );
		
		curr.fParentId = uptd.fParentId;
		curr.parentId = uptd.parentId;
		if ( curr.parentId )
			self.setSuperChild( cId );
		
	}
	
	if ( uptd.name !== curr.name ) {
		curr.name = uptd.name;
		sendUpdate = true;
	}
	
	if( sendUpdate )
		self.sendUpdate( curr.clientId );
	
}

ns.WorgCtrl.prototype.handleGroupDelete = function( swg ) {
	const self = this;
	const fId = self.makeFId( swg.id );
	const wId = self.makeClientId( fId );
	self.remove( wId );
}

ns.WorgCtrl.prototype.handleAddUsers = async function( event ) {
	const self = this;
	if ( !event.userids || !event.userids.length )
		return;
	
	const fId = self.makeFId( event.groupid );
	const worg = self.getByFId( fId );
	if ( !worg ) {
		log( 'handleAddUsers - no worg found for', {
			event : event,
			worgs : self.cMap,
		}, 3 );
		return;
	}
	
	const worgId = worg.clientId;
	const uIds = await self.getUIdsForFUsers( event.userids );
	const added = self.addUsers( worgId, uIds );
	if ( !added )
		return;
	
	self.sendAddedTo( worgId, added );
	
	function get( fId ) {
		return self.idc.getByFUserId( fId );
	}
}

ns.WorgCtrl.prototype.handleSetUsers = async function( event ) {
	const self = this;
	if ( !event.groupid || !event.userids ) {
		log( 'handleSetUsers - invalid event', event );
		return;
	}
	
	const fId = self.makeFId( event.groupid );
	const worg = self.getByFId( fId );
	if ( !worg ) {
		log( 'handleSetUsers - no worg for', event );
		return;
	}
	
	const worgId = worg.clientId;
	const update = await self.getUIdsForFUsers( event.userids );
	const current = self.worgUsers[ worg.clientId ];
	const add = update.filter( notInCurrent );
	const affected = [ ...current, ...add ];
	const remove = current.filter( notInUpdate );
	const removed = self.removeUsers( worgId, remove );
	const added = self.addUsers( worgId, add );
	if ( removed && removed.length )
		self.sendRemovedFrom( worgId, removed );
	
	if ( added && added.length )
		self.sendAddedTo( worgId, added );
	
	self.sendRegenerate( affected );
	
	function notInCurrent( uId ) {
		return !current.some( cId => cId === uId );
	}
	
	function notInUpdate( cId ) {
		return !update.some( uId => uId === cId );
	}
}

ns.WorgCtrl.prototype.handleRemoveUsers = async function( event ) {
	const self = this;
	if ( !event.userids || !event.userids.length )
		return;
	
	const fId = self.makeFId( event.groupid );
	const worg = self.getByFId( fId );
	if ( !worg ) {
		log( 'handleRemoveUsers - no worg found for', {
			event : event,
			worgs : self.cMap,
		}, 3 );
		return;
	}
	
	const worgId = worg.clientId;
	const members = self.worgUsers[ worgId ];
	const affected = [ ...members ];
	const uIds = await self.getUIdsForFUsers( event.userids );
	const removed = self.removeUsers( worgId, uIds );
	self.sendRemovedFrom( worgId, removed );
	self.sendRegenerate( affected );
}

ns.WorgCtrl.prototype.addUsers = function( worgId, userList ) {
	const self = this;
	if ( !worgId || ( !userList || !userList.length )) {
		log( 'addUsers - invalid things', {
			worgId   : worgId,
			userList : userList,
		});
		return null;
	}
	
	const worg = self.get( worgId );
	if ( !worg ) {
		log( 'addUsers - no worg found', {
			worgId : worgId,
			worgs  : self.cMap,
		}, 3 );
		return null;
	}
	
	const added = userList.map( userId => {
		const isMember = self.checkIsMemberOf( worgId, userId );
		if ( isMember )
			return null;
		
		userId = self.addToWorg( worgId, userId );
		return userId;
	}).filter( uId => !!uId );
	
	return added;
}

ns.WorgCtrl.prototype.removeUsers = function( worgId, userList ) {
	const self = this;
	if ( !worgId || ( !userList || !userList.length )) {
		log( 'removeUsers - invalid things', {
			worgId   : worgId,
			userList : userList,
		});
		return null;
	}
	
	const worg = self.get( worgId );
	if ( !worg ) {
		log( 'removeUsers - no worg found', {
			worgId : worgId,
			worgs  : self.cMap,	
		}, 3 );
		return;
	}
	
	const removed = userList.map( userId => {
		return self.removeFromWorg( worgId, userId );
	}).filter( uId => !!uId );
	return removed;
}

ns.WorgCtrl.prototype.setClientId = function( worg ) {
	const self = this;
	if ( !worg || !worg.fId )
		return null;
	
	worg.clientId = self.makeClientId( worg.fId );
	if ( worg.fParentId )
		worg.parentId = self.makeClientId( worg.fParentId );
	else
		worg.parentId = null;
	
	return worg;
}

ns.WorgCtrl.prototype.makeClientId = function( fId ) {
	return 'friend_wg_' + fId;
}

ns.WorgCtrl.prototype.makeFId = function( fcId ) {
	return '' + fcId;
}

ns.WorgCtrl.prototype.updateAvailable = function( worgs ) {
	const self = this;
	if ( !worgs || !worgs.length )
		return;
	
	const currentMap = {};
	worgs.forEach( addNew );
	self.cIds.forEach( removeStale );
	
	function addNew( worg ) {
		if ( !worg.fId ) {
			log( 'updateAvailable - invalid worg', worg );
			return;
		}
		
		if ( !worg.clientId )
			worg = self.setClientId( worg );
		
		currentMap[ worg.clientId ] = true;
		if ( self.fMap[ worg.fId ]) {
			self.checkParent( worg );
			return;
		}
		
		self.add( worg );
	};
	
	function removeStale( cId ) {
		if ( currentMap[ cId ] )
			return;
		
		self.remove( cId );
	}
}

ns.WorgCtrl.prototype.checkParent = function( worg ) {
	const self = this;
	const wId = worg.clientId;
	const current = self.cMap[ wId ];
	if ( current.parentId === worg.parentId )
		return;
	
	if ( worg.parentId )
		self.setSuperChild( wId );
	else
		self.removeSuperChild( wId );
}

ns.WorgCtrl.prototype.setSuperGroups = function( superIds ) {
	const self = this;
	superIds = getClientIds( superIds );
	const removed = removeStale( superIds );
	const added = addNew( superIds );
	setChildren( added );
	
	removed.forEach( cId => {
		const children = self.superChildren[ cId ];
		self.emit( 'super-removed', cId, children );
	});
	
	added.forEach( cId => {
		const children = self.superChildren[ cId ];
		self.emit( 'super-added', cId, children );
	});
	
	unsetChildren( removed );
	
	function getClientIds( fIds ) {
		return fIds.map( fId => {
			let worg = self.fMap[ fId ];
			return worg.clientId;
		});
	}
	
	function removeStale( fresh ) {
		const stale = self.superIds.filter(( currentId, index ) => {
			let isStale = !fresh.some( freshId => freshId === currentId );
			if ( !isStale )
				return false;
			
			self.superIds.splice( index, 1 );
			return true;
		});
		
		return stale;
	}
	
	function addNew( fresh ) {
		const added = fresh.filter( freshId => {
			let isNew = !self.superIds.some( superId => superId === freshId );
			if ( !isNew )
				return false;
			
			self.superIds.push( freshId );
			return true;
		});
		
		return added;
	}
	
	function setChildren( superIds ) {
		superIds.forEach( sId => {
			const superGInDaHouse = self.cMap[ sId ];
			const childrenIds = self.cIds
				.filter( isChild );
			
			self.superChildren[ sId ] = childrenIds;
			
			function isChild( cId ) {
				let child = self.cMap[ cId ];
				return child.parentId === superGInDaHouse.clientId;
			}
		});
		
	}
	
	function unsetChildren( superIds ) {
		superIds.forEach( sId => {
			delete self.superChildren[ sId ];
		});
	}
}

ns.WorgCtrl.prototype.setSuperChild = function( worgId ) {
	const self = this;
	const worg = self.get( worgId );
	if ( !worg.parentId )
		return;
	
	const superId = worg.parentId;
	const superCList = self.superChildren[ superId ];
	if ( !superCList )
		return;
	
	if ( superCList.some( cId => cId === worgId ))
		return;
	
	superCList.push( worgId );
	self.emit( 'sub-added', worgId, superId );
}

ns.WorgCtrl.prototype.removeSuperChild = function( worgId ) {
	const self = this;
	const worg = self.cMap[ worgId ];
	if ( !worg || !worg.parentId ) {
		log( 'removeSuperChild - invalid worg', {
			worgId : worgId,
			worgs  : self.cMap,
		}, 3 );
		return;
	}
	
	const superId = worg.parentId;
	const superCList = self.superChildren[ superId ];
	if ( !superCList )
		return;
	
	const index = superCList.indexOf( worgId );
	if ( -1 === index )
		return;
	
	superCList.splice( index, 1 );
	self.emit( 'sub-removed', worgId, superId );
}

ns.WorgCtrl.prototype.updateUserWorgs = function( accId, worgs ) {
	const self = this;
	if ( !worgs || !worgs.length )
		return;
	
	const memberMap = {};
	const addedTo = worgs.map( addTo )
		.filter( wId => !!wId );
	const removedFrom = self.cIds.map( removeFrom )
		.filter( wId => !!wId );
	
	if ( addedTo && addedTo.length )
		addedTo.forEach( wId => {
			self.sendAddedTo( wId, [ accId ]);
		});
	
	if ( removedFrom && removedFrom.length )
		removedFrom.forEach( wId => {
			self.sendRemovedFrom( wId, [ accId ]);
		});
	
	const affectedWorgs = [ ...addedTo, ...removedFrom ];
	const affectedUIdMap = {};
	affectedWorgs.forEach( setAffUID );
	const affectedUsers = Object.keys( affectedUIdMap );
	self.sendRegenerate( affectedUsers );
	
	return;
	
	function addTo( worg ) {
		let wId = worg.clientId;
		memberMap[ wId ] = true;
		let isMember =  self.checkIsMemberOf( wId, accId );
		if ( !isMember )
			self.addToWorg( wId, accId );
		
		return wId;
	}
	
	function removeFrom( worgId ) {
		if ( memberMap[ worgId ])
			return null;
		
		// not a member
		let isInList = self.checkIsMemberOf( worgId, accId );
		if ( !isInList )
			return null;
		
		/*
		let uList = self.worgUsers[ worgId ];
		let index = uList.indexOf( accId );
		
		uList.splice( index, 1 );
		*/
		return self.removeFromWorg( worgId, accId );
	}
	
	function setAffUID( worgId ) {
		const members = self.worgUsers[ worgId ];
		members.forEach( uid => {
			affectedUIdMap[ uid ] = true;
		});
	}
}

ns.WorgCtrl.prototype.updateStreamWorgs = function( accId, streamWorgNames ) {
	const self = this;
	if ( !streamWorgNames || !streamWorgNames.length )
		return;
	
	const current = {};
	const added = [];
	streamWorgNames.forEach( addMaybe );
	// TODO emit added probably
	const remove = self.streamWorgs.filter( isStale );
	remove.forEach( wId => self.removeStreamWorg( wId ));
	
	function addMaybe( worgName ) {
		let worg = self.getWorgByName( worgName );
		if ( !worg )
			return;
		
		let wId = worg.clientId;
		current[ wId ] = true;
		if ( !isSet( wId )) {
			self.addStreamWorg( wId );
			added.push( wId );
		}
	}
	
	function isSet( worgId ) {
		return self.streamWorgs.some( streamWorgId => worgId === streamWorgId );
	}
	
	function isStale( streamWorgId ) {
		return !current[ streamWorgId ];
	}
}

ns.WorgCtrl.prototype.getWorgByName = function( worgName ) {
	const self = this;
	let namedWorg = null;
	self.cIds.some( lookup );
	return namedWorg;
	
	function lookup( wId ) {
		let worg = self.cMap[ wId ];
		if ( worgName === worg.name ) {
			namedWorg = worg;
			return true;
		}
		
		return false;
	};
}

ns.WorgCtrl.prototype.addStreamWorg = function( worgId ) {
	const self = this;
	self.streamWorgs.push( worgId );
	let userList = self.getUserList( worgId );
	userList.forEach( accId => self.setStreamer( accId, worgId ));
}

ns.WorgCtrl.prototype.setStreamer = function( accId, worgId ) {
	const self = this;
	if ( !self.streamers[ accId ])
		setNew( accId, worgId );
	else
		addToExistingMaybe( accId, worgId );
	
	function setNew( accId, worgId ) {
		self.streamers[ accId ] = [
			worgId,
		];
	}
	
	function addToExistingMaybe( accId, worgId ) {
		let streamer = self.streamers[ accId ];
		let added = streamer.some( wId => wId === worgId );
		if ( added )
			return;
		
		streamer.push( worgId );
	}
}

ns.WorgCtrl.prototype.addToWorg = function( worgId, userId ) {
	const self = this;
	const worg = self.worgUsers[ worgId ];
	let user = self.userWorgs[ userId ];
	if ( !worg ) {
		log( 'addToWorg - no worg', {
			wId  : worgId,
			uId  : userId,
			worg : worg,
			user : user,
		});
		return null;
	}
	
	if ( !user ) {
		user = [];
		self.userWorgs[ userId ] = user;
	}
	
	worg.push( userId );
	user.push( worgId );
	return userId;
}

ns.WorgCtrl.prototype.sendAddedTo = function( worgId, userIds ) {
	const self = this;
	self.emit( 'users-added', worgId, userIds );
}

ns.WorgCtrl.prototype.removeFromWorg = function( worgId, userId ) {
	const self = this;
	const worg = self.worgUsers[ worgId ];
	const user = self.userWorgs[ userId ];
	if ( !worg ) {
		log( 'removeFromWorg - no worg', {
			wId  : worgId,
			uId  : userId,
			worg : worg,
			user : user,
		});
		return null;
	}
	
	const uIndex = worg.indexOf( userId );
	if ( -1 != uIndex )
		worg.splice( uIndex, 1 );
	else
		return null;
	
	if ( !user )
		return userId;
	
	const wIndex = user.indexOf( worgId );
	if ( -1 != wIndex )
		user.splice( wIndex, 1 );
	
	return userId;
}

ns.WorgCtrl.prototype.sendRemovedFrom = function( worgId, removedUIds ) {
	const self = this;
	self.emit( 'users-removed', worgId, removedUIds );
}

ns.WorgCtrl.prototype.sendRegenerate = function( userList ) {
	const self = this;
	self.emit( 'regenerate', userList );
}

ns.WorgCtrl.prototype.sendUpdate = function( clientId ) {
	const self = this;
	const worg = self.cMap[ clientId ];
	self.emit( 'update', worg );
}

ns.WorgCtrl.prototype.checkIsMemberOf = function( worgId, accId ) {
	const self = this;
	let worg = self.worgUsers[ worgId ];
	if ( !worg || !worg.length )
		return false;
	
	return worg.some( mId => mId === accId );
}

ns.WorgCtrl.prototype.cId_to_fId_list = function( cId_list ) {
	const self = this;
	return cId_list.map( cId => {
		let wg = self.cMap[ cId ];
		let fId = wg.fId;
		return fId;
	});
}

ns.WorgCtrl.prototype.normalizeServiceWorg = function( swg ) {
	const self = this;
	const wg = {
		fId       : self.makeFId( swg.id ),
		fParentId : getPId( swg.parentid ),
		name      : swg.name,
	};
	return self.setClientId( wg );
	
	function getPId( fPId ) {
		if ( !fPId )
			return null;
		
		if ( '0' == fPId )
			return null;
		
		return self.makeFId( fPId );
	}
}

ns.WorgCtrl.prototype.getUIdsForFUsers = async function( fUsers ) {
	const self = this;
	if ( !fUsers || !fUsers.length )
		return [];
	
	const users = await Promise.all( fUsers.map( fu => {
		const fId = fu.uuid;
		return self.idc.getByFUserId( fId );
	}));
	
	const uIds = users
		.filter( u => !!u )
		.map( u => u.clientId );
	
	return uIds;
}

module.exports = ns.WorgCtrl;
