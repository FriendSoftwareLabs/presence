/*
	IMPORTANT: Execute this file from the mysql cli, running it in phpMyAdmin will fail.
	This is because :phpMyAdminTrollface.jpg: 
	and not a problem with the script itself. Must be. No other possible explanation.
*/

DELIMITER //

#
DROP PROCEDURE IF EXISTS set_last_patch_version;
# ACCOUNT
DROP PROCEDURE IF EXISTS account_create;
DROP PROCEDURE IF EXISTS account_read;
DROP PROCEDURE IF EXISTS account_update;
DROP PROCEDURE IF EXISTS account_delete;
DROP PROCEDURE IF EXISTS account_touch;
DROP PROCEDURE IF EXISTS account_set_pass;
DROP PROCEDURE IF EXISTS account_set_name;
DROP PROCEDURE IF EXISTS account_update_avatar;
DROP PROCEDURE IF EXISTS account_set_settings;
DROP PROCEDURE IF EXISTS account_get_settings;
DROP PROCEDURE IF EXISTS account_set_active;
# ROOM
DROP PROCEDURE IF EXISTS room_create;
DROP PROCEDURE IF EXISTS room_read;
DROP PROCEDURE IF EXISTS room_update;
DROP PROCEDURE IF EXISTS room_delete;
DROP PROCEDURE IF EXISTS room_touch;
DROP PROCEDURE IF EXISTS room_set_name;
DROP PROCEDURE IF EXISTS room_set_owner;
# AUTH
DROP PROCEDURE IF EXISTS auth_get_for_room;
DROP PROCEDURE IF EXISTS auth_get_for_account;
DROP PROCEDURE IF EXISTS auth_add;
DROP PROCEDURE IF EXISTS auth_remove;
# MESSAGE
DROP PROCEDURE IF EXISTS message_set;
DROP PROCEDURE IF EXISTS message_get_asc;
DROP PROCEDURE IF EXISTS message_get_desc;
DROP PROCEDURE IF EXISTS message_get_after;
DROP PROCEDURE IF EXISTS message_get_before;

# UTIL
DROP FUNCTION IF EXISTS fn_split_str;

#
# UTIL
#

# RETURN PART OF A DELIMITED STRING BY INDEX

CREATE FUNCTION fn_split_str(
	source TEXT,
	delim CHAR(12),
	pos INT
)
RETURNS VARCHAR( 255 ) DETERMINISTIC
RETURN REPLACE(SUBSTRING(SUBSTRING_INDEX( source, delim, pos),
		LENGTH(SUBSTRING_INDEX( source, delim, pos -1)) + 1),
		delim, '')//


#
#
CREATE PROCEDURE set_last_patch_version(
	IN `version` INT,
	IN `comment` VARCHAR( 255 )
)
BEGIN
	INSERT INTO `db_history` (
		`version`,
		`comment`
	) VALUES (
		`version`,
		`comment`
	);
END//

#
# ACCOUNT
#

#
# CREATE
CREATE PROCEDURE account_create(
	IN `clientId` VARCHAR( 255 ),
	IN `login` VARCHAR( 255 ),
	IN `pass` TEXT,
	IN `name` VARCHAR( 255 ),
	IN `settings` TEXT
)
BEGIN
	INSERT INTO `account` (
		`clientId`,
		`login`,
		`pass`,
		`name`,
		`settings`
	) VALUES (
		`clientId`,
		`login`,
		`pass`,
		`name`,
		`settings`
	);
	
	SELECT * FROM `account` AS a
	WHERE a.clientId = `clientId`
	AND a.login = `login`;
END//


#
# READ
CREATE PROCEDURE account_read(
	IN `login` VARCHAR( 255 )
)
BEGIN
	SELECT * FROM account
	WHERE account.login = `login`;
END//

#
# UPDATE
# see below for per-field sets
CREATE PROCEDURE account_update(
)
BEGIN

END//

#
# DELETE
CREATE PROCEDURE account_delete(
	IN `clientId` VARCHAR( 255 )
)
BEGIN
	DELETE FROM account
	WHERE acount.clientId = `clientId`;
END//

#
# TOUCH
CREATE PROCEDURE account_touch(
	IN `clientId` VARCHAR( 255 )
)
BEGIN
	UPDATE account 
	SET lastLogin = NOW()
	WHERE account.clientId = `clientId`;
END//

#
# SET PASS
CREATE PROCEDURE account_set_pass(
	IN `clientId` VARCHAR( 255 ),
	IN `pass` TEXT
)
BEGIN
	UPDATE account AS a
	SET a.pass = `pass`
	WHERE a.clientId = `clientId`;
END//

#
# SET NAME
CREATE PROCEDURE account_set_name(
	IN `clientId` VARCHAR( 255 ),
	IN `name` VARCHAR( 255 )
)
BEGIN
	UPDATE account AS a
	SET a.name = `name`
	WHERE a.clientId = `clientId`;
END//

#
# SET AVATAR
CREATE PROCEDURE account_update_avatar(
	IN `clientId` VARCHAR( 191 ),
	IN `avatar` TEXT
)
BEGIN
	UPDATE account AS a
	SET a.avatar = `avatar`
	WHERE a.clientId = `clientId`;
END//

#
# SET SETTINGS
CREATE PROCEDURE account_set_settings(
	IN `clientId` VARCHAR( 191 ),
	IN `update` JSON
)
BEGIN
	
END//

#
# GET SETTINGS
CREATE PROCEDURE account_get_settings(
	IN `clientId` VARCHAR( 191 )
)
BEGIN
	SELECT a.settings FROM account AS a;
END//

#
# SET ACTIVE
CREATE PROCEDURE account_set_active(
	IN `clientId` VARCHAR( 191 ),
	IN `active` BOOLEAN
)
BEGIN
	UPDATE account AS a
	SET a.active = `active`
	WHERE a.clientId = `clientId`;
END//


#
# ROOM
#

#
# CREATE
CREATE PROCEDURE room_create(
	IN `clientId` VARCHAR( 255 ),
	IN `name` VARCHAR( 255 ),
	IN `ownerId` VARCHAR( 255 ),
	IN `settings` TEXT,
	IN `isPrivate` BOOLEAN
)
BEGIN
	INSERT INTO `room` (
		`clientId`,
		`name`,
		`ownerId`,
		`settings`,
		`isPrivate`
	) VALUES (
		`clientId`,
		`name`,
		`ownerId`,
		`settings`,
		`isPrivate`
	);
	
	SELECT * FROM `room`
	WHERE room.clientId = `clientId`;
END//

#
# READ
CREATE PROCEDURE room_read(
	IN `clientId` VARCHAR( 255 )
)
BEGIN
	SELECT * FROM room
	WHERE room.clientId = `clientId`;
END//

#
# UPDATE
# use the per-field procs, found below
CREATE PROCEDURE room_update(
)
BEGIN

END//

#
# DELETE
CREATE PROCEDURE room_delete(
	IN `clientId` VARCHAR( 255 )
)
BEGIN
	DELETE FROM room
	WHERE room.clientId = `clientId`;
END//

#
# TOUCH
CREATE PROCEDURE room_touch(
	IN `clientId` VARCHAR( 255 )
)
BEGIN
	UPDATE room AS r
	SET r.lastActivity = NOW()
	WHERE r.clientId = `clientId`;
END//

#
# SET NAME
CREATE PROCEDURE room_set_name(
	IN `clientId` VARCHAR( 255 ),
	IN `name` VARCHAR( 255 )
)
BEGIN
	UPDATE room AS r
	SET r.name = `name`
	WHERE r.clientId = `clientId`;
END//

#
# SET OWNER
CREATE PROCEDURE room_set_owner(
	IN `clientId` VARCHAR( 255 ),
	IN `ownerId` VARCHAR( 255 )
)
BEGIN
	UPDATE room AS r
	SET r.ownerId = `ownerId`
	WHERE r.clientId = `clientId`;
END//

#
# AUTHORIZED
#

#
# load account authorizations for a room
CREATE PROCEDURE auth_get_for_room(
	IN `roomId` VARCHAR( 255 )
)
BEGIN
	SELECT 
		a.clientId,
		a.login,
		a.name,
		a.avatar,
		a.active,
		a.lastLogin,
		a.lastOnline 
	FROM `authorized_for_room` AS auth 
	LEFT JOIN `account` AS a 
	ON auth.accountId = a.clientId 
	WHERE auth.roomId = `roomId`;
END//

#
# load rooms available for an account
CREATE PROCEDURE auth_get_for_account(
	IN `accountId` VARCHAR( 255 )
)
BEGIN
	SELECT r.clientId, r.name, r.ownerId FROM `authorized_for_room` AS auth 
	LEFT JOIN `room` AS r 
	ON auth.roomId = r.clientId 
	WHERE auth.accountId = `accountId`;
END//

#
# set auths for a room
CREATE PROCEDURE auth_add(
	IN `roomId`      VARCHAR( 255 ),
	IN `accIdsDelim` TEXT
)
BEGIN
	DECLARE i INT DEFAULT 0;
	DECLARE str VARCHAR( 255 );
	DROP TEMPORARY TABLE IF EXISTS str_split_tmp;
	CREATE TEMPORARY TABLE str_split_tmp( `str` VARCHAR( 255 ));
	loopie: LOOP
		SET i=i+1;
		SET str=fn_split_str( accIdsDelim, '|', i );
		IF str='' THEN
			LEAVE loopie;
		END IF;
		INSERT INTO str_split_tmp VALUES( str );
	END LOOP loopie;
	
	#SELECT * FROM str_split_tmp;
	INSERT INTO `authorized_for_room` (
		`roomId`,
		`accountId`
	) SELECT `roomId`, s.str FROM str_split_tmp as s;
END//

#
# REMOVE ACCOUNT FROM ROOM
CREATE PROCEDURE auth_remove(
	IN `roomId` VARCHAR( 255 ),
	IN `accountId` VARCHAR( 255 )
)
BEGIN
	DELETE afr FROM authorized_for_room AS afr
	WHERE afr.roomId = `roomId` AND afr.accountId = `accountId`;
END//

#
# MESSAGE
#

#
# message_set
CREATE PROCEDURE message_set(
	IN `msgId`     VARCHAR( 191 ),
	IN `roomId`    VARCHAR( 191 ),
	IN `accountId` VARCHAR( 191 ),
	IN `timestamp` BIGINT,
	IN `type`      VARCHAR( 20 ),
	IN `name`      VARCHAR( 191 ),
	IN `message`   TEXT
)
BEGIN
INSERT INTO `message` (
	`msgId`,
	`roomId`,
	`accountId`,
	`timestamp`,
	`type`,
	`name`,
	`message`
) VALUES (
	`msgId`,
	`roomId`,
	`accountId`,
	`timestamp`,
	`type`,
	`name`,
	`message`
);
END//

# message_get_desc
CREATE PROCEDURE message_get_desc(
	IN `roomId` VARCHAR( 191 ),
	IN `length` INT
)
BEGIN
SELECT
	tmp.msgId,
	tmp.roomId,
	tmp.accountId AS `fromId`,
	tmp.timestamp AS `time`,
	tmp.type,
	tmp.name,
	tmp.message
FROM (
	SELECT * FROM message AS m
	WHERE m.roomId = `roomId`
	ORDER BY m._id DESC
	LIMIT 0, `length`
) AS tmp
ORDER BY tmp._id ASC;
END//

# message_get_asc
CREATE PROCEDURE message_get_asc(
	IN `roomId` VARCHAR( 191 ),
	IN `length` INT
)
BEGIN
SELECT
	tmp.msgId,
	tmp.roomId,
	tmp.accountId AS `fromId`,
	tmp.timestamp AS `time`,
	tmp.type,
	tmp.name,
	tmp.message
FROM (
	SELECT * FROM message AS m
	WHERE m.roomId = `roomId`
	ORDER BY m._id ASC
	LIMIT 0, `length`
) AS tmp;
END//

#mesage_get_after
CREATE PROCEDURE message_get_after(
	IN `roomId` VARCHAR( 191 ),
	IN `lastId` VARCHAR( 191 ),
	IN `length` INT
)
BEGIN
SELECT
	tmp.msgId,
	tmp.roomId,
	tmp.accountId AS `fromId`,
	tmp.timestamp AS `time`,
	tmp.type,
	tmp.name,
	tmp.message
FROM (
	SELECT  * FROM message AS m
	WHERE m.roomId = `roomId`
	AND m._id > (
		SELECT l._id
		FROM message AS l
		WHERE l.msgId = `lastId`
	)
	ORDER BY m._id ASC
	LIMIT `length`
) AS tmp;
END//

# message_get_before
CREATE PROCEDURE message_get_before(
	IN `roomId` VARCHAR( 191 ),
	IN `startId` VARCHAR( 191 ),
	IN `length` INT
)
BEGIN
SELECT
	tmp.msgId,
	tmp.roomId,
	tmp.accountId AS `fromId`,
	tmp.timestamp AS `time`,
	tmp.type,
	tmp.name,
	tmp.message
FROM (
	SELECT * FROM message AS m
	WHERE m.roomId = `roomId`
	AND m._id < (
		SELECT s._id
		FROM message AS s
		WHERE s.msgId = `startId`
	)
	ORDER BY m._id DESC
	LIMIT `length`
) AS tmp
ORDER BY tmp._id ASC;
END//

