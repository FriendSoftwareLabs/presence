/*©agpl*************************************************************************
*                                                                              *
* Friend Unifying Platform                                                     *
* ------------------------                                                     *
*                                                                              *
* Copyright 2014-2016 Friend Software Labs AS, all rights reserved.            *
* Hillevaagsveien 14, 4016 Stavanger, Norway                                   *
* Tel.: (+47) 40 72 96 56                                                      *
* Mail: info@friendos.com                                                      *
*                                                                              *
*****************************************************************************©*/

'use strict';

const log = require( './component/Log' )( 'presence' );
//const CassPool = require( './component/Cassandra' );
const MySQLPool = require( './component/MysqlPool' );
const RoomCtrl = require( './component/RoomCtrl' );
const NML = require( './component/NoMansLand' );
var conf = require( './component/Config' ); // not really bothering with saving the obj,
                                            // it writes itself to global.config

log( 'conf', conf, 4 );

const fcReq = require( './component/FCRequest' )( global.config.server.friendcore );

var presence = {
	conn  : null,
	db    : null,
	rooms : null,
};

presence.db = new MySQLPool( global.config.server.mysql, dbReady );
function dbReady( ok ) {
	if ( !ok )
		throw new Error( 'db failed?' );
	
	presence.rooms = new RoomCtrl( presence.db );
	openComms();
}

function openComms() {
	presence.conn = new NML( presence.db, presence.rooms, fcReq );
}

