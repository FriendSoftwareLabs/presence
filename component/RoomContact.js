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

const log = require( './Log' )( 'ContactRoom' );
const Room = require( './Room' );
const components = require( './RoomComponents' );
const Signal = require( './Signal' );
const dFace = require( './DFace' );
const Janus = require( './Janus' );
const util = require( 'util' );

var ns = {};

ns.ContactRoom = function( conf, db, idCache ) {
    const self = this;
    Room.call( self, conf, db, idCache );
}

util.inherits( ns.ContactRoom, Room );

ns.ContactRoom.prototype.setRelation = async function( relation ) {
    const self = this;
    const auth = [
        relation.relations[ 0 ].userId,
        relation.relations[ 1 ].userId,
    ];
    
    const roomDb = new dFace.RoomDB( self.dbPool, self.id );
    await roomDb.authorize(
        self.id,
        auth,
    );
    await self.loadUsers();
}

ns.ContactRoom.prototype.connect = async function( userId ) {
    const self = this;
    const authed = self.checkIsAuthed( userId );
    if ( !authed )
        return false;
    
    if ( !self.users[ userId ])
        await self.addUser( userId );
    
    const signal = self.bindUser( userId );
    if ( self.emptyTimer ) {
        clearTimeout( self.emptyTimer );
        self.emptyTimer = null;
    }
    
    return signal;
}

ns.ContactRoom.prototype.disconnect = function( accountId ) {
    const self = this;
    self.releaseUser( accountId );
}

ns.ContactRoom.prototype.authorizeUser = async function( userId ) {
    const self = this;
    return false;
}

ns.ContactRoom.prototype.authenticateInvite = async function( token ) {
    const self = this;
    return false;
}

ns.ContactRoom.prototype.getOtherAccount = function( accId ) {
    const self = this;
    let otherId;
    if ( accId === self.accIdA )
        otherId = self.accIdB;
    else
        otherId = self.accIdA;
    
    return self.users[ otherId ];
}

ns.ContactRoom.prototype.init = function() {
    const self = this;
    self.roomDb = new dFace.RoomDB( self.dbPool, self.id );
    self.settings = new ns.ContactSettings(
        self.dbPool,
        self.id,
        self.users,
        self.onlineList,
        settingsDone
    );
    
    async function settingsDone( err , res ) {
        self.log = new ns.ContactLog(
            self.dbPool,
            self.id,
            self.users,
            self.activeList,
            self.idCache,
            self.ownerId
        );
        
        self.chat = new components.Chat(
            self.id,
            self.users,
            self.onlineList,
            self.log
        );
        
        self.live = new components.Live(
            self.users,
            self.onlineList,
            self.log,
            null,
            self.settings
        );
        
        try {
            await self.loadUsers();
        } catch( e ) {
            log( 'load fail', e );
        }
        self.setOpen();
    }
}

ns.ContactRoom.prototype.loadUsers = async function() {
    const self = this;
    let auths = null;
    try {
        auths = await self.roomDb.loadAuthorizations( self.id );
    } catch ( e ) {
        log( 'loading auths failed', e.stack || e );
        return false;
    }
    
    if ( !auths || 2 !== auths.length ) {
        log( 'loadUsers - invalid number of users', auths );
        return false;
    }
    
    try {
        await Promise.all( auths.map( await add ));
    } catch ( e ) {
        log( 'opps', e.stack || e );
    }
    
    return true;
    
    async function add( dbUser ) {
        await self.addUser( dbUser.clientId );
    }
}

ns.ContactRoom.prototype.bindUser = function( userId ) {
    const self = this;
    const id = self.users[ userId ];
    if ( !id ) {
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
    
    // removing basic user obj
    delete self.users[ userId ];
    
    const otherAcc = self.getOtherAccount( userId );
    const otherId = otherAcc.clientId;
    const otherName = otherAcc.name;
    // add signal user obj
    const sigConf = {
        roomId     : otherId,
        roomName   : otherName,
        isPrivate  : true,
        persistent : true,
        clientId   : id.clientId,
        name       : id.name,
        avatar     : id.avatar,
        isOwner    : false,
        isAuthed   : true,
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
    user.on( 'active', active );
    user.on( 'open', open );
    
    let uid = userId;
    function init( e ) { self.initialize( e, uid ); }
    function persist( e ) { self.handlePersist( e, uid ); }
    function identity( e ) { self.setIdentity( e, uid ); }
    function goOffline( e ) { self.disconnect( uid ); }
    function leaveRoom( e ) { self.handleLeave( uid ); }
    function joinLive( e ) { self.handleJoinLive( e, uid ); }
    function leaveLive( e ) { self.handleLeaveLive( e, uid ); }
    function active( e ) { self.handleActive( e, uid ); }
    function open( e ) { self.handleOpen( uid ); }
    
    // add to components
    self.chat.bind( userId );
    self.settings.bind( userId );
    
    // show online
    self.setOnline( userId );
    return user;
}

ns.ContactRoom.prototype.handleActive = function( event, userId ) {
    const self = this;
    if ( event.isActive )
        add( userId );
    else
        remove( userId );
    
    function add( uId ) {
        if ( false !== indexInList( uId ))
            return;
        
        self.activeList.push( uId );
    }
    
    function remove( uId ) {
        let index = indexInList( uId );
        if ( false === index )
            return;
        
        self.activeList.splice( index, 1 );
    }
    
    function indexInList( uId ) {
        let index = self.activeList.indexOf( uId );
        if ( -1 === index )
            return false;
        else
            return index;
    }
}

ns.ContactRoom.prototype.setOnline = function( userId ) {
    const self = this;
    const user = self.users[ userId ];
    if ( !user )
        return null;
    
    self.onlineList.push( userId );
    
    /*
    const online = {
        type : 'online',
        data : true,
    };
    const otherAcc = self.getOtherAccount( userId );
    self.send( online, otherAcc.accountId );
    */
    return user;
}

ns.ContactRoom.prototype.setOffline = function( userId ) {
    const self = this;
    const userIndex = self.onlineList.indexOf( userId );
    if ( -1 !== userIndex ) {
        let removed = self.onlineList.splice( userIndex, 1 );
    }
}

ns.ContactRoom.prototype.handleOpen = function( userId ) {
    const self = this;
    const open = {
        type : 'open',
        data : true,
    };
    self.send( open, userId );
}

ns.ContactRoom.prototype.initialize = function( requestId, userId ) {
    const self = this;
    const otherAcc = self.getOtherAccount( userId );
    const state = {
        id          : otherAcc.clientId,
        name        : otherAcc.name,
        ownerId     : self.ownerId,
        persistent  : self.persistent,
        isPrivate   : true,
        settings    : self.settings.get(),
        guestAvatar : self.guestAvatar,
        users       : buildBaseUsers(),
        online      : self.onlineList,
        identities  : self.identities,
        peers       : self.live.peerIds,
        workgroups  : null,
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
                isAuthed   : true,
                isGuest    : false,
                workgroups : [],
            };
        }
    }
}

ns.ContactRoom.prototype.addUser = async function( userId ) {
    const self = this;
    // add to users
    if ( self.users[ userId ]) {
        return userId;
    }
    
    const user = await self.idCache.get( userId );
    self.users[ userId ] = user;
    self.authorized.push( userId );
    
    if ( self.accIdB )
        return true;
    
    if ( self.accIdA )
        self.accIdB = userId;
    else
        self.accIdA = userId;
    
    return true;
}

/*
    ContactSettings
*/

const sLog = require( './Log' )( 'ContactRoom > Settings' );
ns.ContactSettings = function(
    dbPool,
    roomId,
    users,
    onlineList,
    callback
) {
    const self = this;
    components.Settings.call( self,
        dbPool,
        null,
        roomId,
        users,
        onlineList,
        true,
        null,
        callback
    );
}

util.inherits( ns.ContactSettings, components.Settings );

ns.ContactSettings.prototype.init = function( dbPool, ignore, callback ) {
    const self = this;
    self.conn = new components.UserSend( 'settings', self.users, self.onlineList );
    self.handlerMap = {
    };
    
    self.list = Object.keys( self.handlerMap );
    self.db = new dFace.RoomDB( dbPool, self.roomId );
    self.db.getSettings()
        .then( settings )
        .catch( loadErr );
    
    function settings( res ) {
        self.setDbSettings( res );
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

ns.ContactSettings.prototype.setDbSettings = function( settings ) {
    const self = this;
    let keys = Object.keys( settings );
    keys.forEach( add );
    self.settingStr = JSON.stringify( self.setting );
    
    function add( key ) {
        let value = settings[ key ];
        self.setting[ key ] = value;
    }
}

ns.ContactSettings.prototype.setDefaults = function() {
    const self = this;
    //self.set( 'userLimit', 0 );
    //self.set( 'isStream', false );
}


/*
    ContactLog
*/
const llLog = require( './Log' )( 'ContactRoom > Log' );
ns.ContactLog = function(
    dbPool,
    roomId,
    users,
    activeList,
    idCache,
    relationId
) {
    const self = this;
    self.activeList = activeList;
    self.relationId = relationId;
    components.Log.call(
        self,
        dbPool,
        roomId,
        users,
        idCache,
        true
    );
}

util.inherits( ns.ContactLog, components.Log );

// Public

ns.ContactLog.prototype.baseClose = ns.ContactLog.prototype.close;
ns.ContactLog.prototype.close = function() {
    const self = this;
    delete self.activeList;
    delete self.relationId;
    self.baseClose();
}

ns.ContactLog.prototype.confirm = async function( msgId, userId ) {
    const self = this;
    if ( !msgId || !userId )
        return;
    
    try {
        await self.msgDb.updateUserLastRead( self.relationId, userId, msgId );
    } catch( err ) {
        llLog( 'confirm - db fail', err );
        return false;
    }
    
    return true;
}

// Private

ns.ContactLog.prototype.persist = async function( event ) {
    const self = this;
    const item = event.data;
    item.type = event.type;
    const fromId = item.fromId;
    try {
        await self.msgDb.setForRelation( item, self.relationId, self.activeList );
    } catch( err ) {
        llLog( 'persist - err', err );
        return false;
    }
    
    return true;
}

//

module.exports = ns.ContactRoom;
