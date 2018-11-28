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

// Do not edit example.config.js! It is overwritten.
// Make changes to config.js, it is created by the installer.

var server = {
	mysql : {
		host : 'presence_database_host',
		port : 3306,
		user : 'presence_database_user',
		pass : 'presence_database_password',
		name : 'presence_database_name',
	},
	tls : {
		keyPath  : 'path_to_key.pem',
		certPath : 'path_to_cert.pem',
		key      : null,
		cert     : null,
	},
	// failure to provide this means invites wont work
	domain : 'presence_domain',
	tcp : {
		port  : 27960,
		proxy : null,
	},
	ws : {
		port : 27970,
		proxy : null,
		// proxy : '/presence/guest/',
	},
	friendcore : {
		useTLS      : true,
		host        : 'friendcore_domain',
		port        : 6502,
		proxy       : null,
		wsPort      : 6500,
		wsProxy     : null,
		serviceKey  : null,
		serviceName : null,
	},
	account : {
		settings : {
		},
	},
	room : {
		settings : {
		},
	},
	streamProxy    : null,
	classroomProxy : null,
	janus : {
		api_url    : null,
		api_secret : null,
	},
};

var shared = {
	rtc : {
		iceServers : [
			{
				urls : [
					"stun:stun_url.com",
				],
			},
			{
				urls : [
					"turn:turn_url.com",
				],
				username : 'turn_username',
				credential : 'turn_password',
			},
		],
	},
};

var conf = {
	shared : shared,
	server : server,
};

module.exports = conf;
