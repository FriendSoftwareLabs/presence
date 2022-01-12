/*
	IMPORTANT: Execute this file from the mysql cli, running it in phpMyAdmin will fail.
	This is because :phpMyAdminTrollface.jpg: and not a problem with the script itself. 
	
	Or just let the server run it on startup..
*/

DELIMITER //

#
DROP PROCEDURE IF EXISTS set_last_patch_version;

# STATISTICS
DROP PROCEDURE IF EXISTS stats_user_relation_date;
DROP PROCEDURE IF EXISTS stats_user_chats_date;

# ACCOUNT
DROP PROCEDURE IF EXISTS account_create;
DROP PROCEDURE IF EXISTS account_set_fuserid;
DROP PROCEDURE IF EXISTS account_read_id;
DROP PROCEDURE IF EXISTS account_read_fuserid;
DROP PROCEDURE IF EXISTS account_read_fusername;
DROP PROCEDURE IF EXISTS account_read_alphanum;
DROP PROCEDURE IF EXISTS account_search;
DROP PROCEDURE IF EXISTS account_update;
DROP PROCEDURE IF EXISTS account_delete;
DROP PROCEDURE IF EXISTS account_touch;
DROP PROCEDURE IF EXISTS account_set_pass;
DROP PROCEDURE IF EXISTS account_update_name;
DROP PROCEDURE IF EXISTS account_update_avatar;
DROP PROCEDURE IF EXISTS account_update_fisdisabled;
DROP PROCEDURE IF EXISTS account_update_flastupdate;
DROP PROCEDURE IF EXISTS account_set_settings;
DROP PROCEDURE IF EXISTS account_get_settings;
DROP PROCEDURE IF EXISTS account_set_active;

# ROOM
DROP PROCEDURE IF EXISTS room_create;
DROP PROCEDURE IF EXISTS room_read;
DROP PROCEDURE IF EXISTS room_read_all;
DROP PROCEDURE IF EXISTS room_update;
DROP PROCEDURE IF EXISTS room_delete;
DROP PROCEDURE IF EXISTS room_touch;
DROP PROCEDURE IF EXISTS room_set_name;
DROP PROCEDURE IF EXISTS room_set_owner;
DROP PROCEDURE IF EXISTS room_get_assigned_workgroups;
DROP PROCEDURE IF EXISTS room_assign_workgroup;
DROP PROCEDURE IF EXISTS room_dismiss_workgroup;
DROP PROCEDURE IF EXISTS room_get_assigned_to;
DROP PROCEDURE IF EXISTS room_create_for_workgroup;
DROP PROCEDURE IF EXISTS room_get_for_workgroup;

# USER RELATION
DROP PROCEDURE IF EXISTS user_relation_create;
DROP PROCEDURE IF EXISTS user_relation_assign_room;
DROP PROCEDURE IF EXISTS user_relation_read;
DROP PROCEDURE IF EXISTS user_relation_read_all_for;
DROP PROCEDURE IF EXISTS user_relation_state;
DROP PROCEDURE IF EXISTS user_relation_messages;
DROP PROCEDURE IF EXISTS user_relation_update_last_read;
DROP PROCEDURE IF EXISTS user_relation_update_messages;

# AUTH
DROP PROCEDURE IF EXISTS auth_get_for_room;
DROP PROCEDURE IF EXISTS auth_get_for_account;
DROP PROCEDURE IF EXISTS auth_get_for_workgroups;
DROP PROCEDURE IF EXISTS auth_add;
DROP PROCEDURE IF EXISTS auth_check;
DROP PROCEDURE IF EXISTS auth_remove;

# MESSAGE
DROP PROCEDURE IF EXISTS message_set;
DROP PROCEDURE IF EXISTS message_set_work_target;
DROP PROCEDURE IF EXISTS message_get_by_id;
DROP PROCEDURE IF EXISTS message_get_asc;
DROP PROCEDURE IF EXISTS message_get_desc;
DROP PROCEDURE IF EXISTS message_get_after;
DROP PROCEDURE IF EXISTS message_get_before;
DROP PROCEDURE IF EXISTS message_get_with_work_targets;
DROP PROCEDURE IF EXISTS message_get_work_targets_after;
DROP PROCEDURE IF EXISTS message_get_work_targets_before;
DROP PROCEDURE IF EXISTS message_get_work_targets_between;
DROP PROCEDURE IF EXISTS message_get_for_view;
DROP PROCEDURE IF EXISTS message_update;
DROP PROCEDURE IF EXISTS message_set_edit;
DROP PROCEDURE IF EXISTS message_set_status;

DROP PROCEDURE IF EXISTS room_user_messages_set;
DROP PROCEDURE IF EXISTS room_user_messages_load;
DROP PROCEDURE IF EXISTS room_user_messages_update;
DROP PROCEDURE IF EXISTS room_user_messages_count_unread;
DROP PROCEDURE IF EXISTS room_user_messages_count_unread_worg;

#INVITE TOKENS
DROP PROCEDURE IF EXISTS invite_set;
DROP PROCEDURE IF EXISTS invite_get;
DROP PROCEDURE IF EXISTS invite_get_room;
DROP PROCEDURE IF EXISTS invite_get_target;
DROP PROCEDURE IF EXISTS invite_check_exists;
DROP PROCEDURE IF EXISTS invite_check_room;
DROP PROCEDURE IF EXISTS invite_invalidate;
DROP PROCEDURE IF EXISTS invite_used;

# UTIL
DROP FUNCTION IF EXISTS fn_split_str;
DROP FUNCTION IF EXISTS fn_get_msg_time;

# SETTINGS
DROP PROCEDURE IF EXISTS account_settings_get;
DROP PROCEDURE IF EXISTS account_settings_get_by_key;
DROP PROCEDURE IF EXISTS account_settings_set_key_value;
DROP PROCEDURE IF EXISTS account_settings_remove_key;

DROP PROCEDURE IF EXISTS room_settings_get;
DROP PROCEDURE IF EXISTS room_settings_get_by_key;
DROP PROCEDURE IF EXISTS room_settings_set_key_value;
DROP PROCEDURE IF EXISTS room_settings_remove_key;

#
# UTIL 
#

# RETURN PART OF A DELIMITED STRING BY INDEX
CREATE FUNCTION fn_split_str(
	source TEXT,
	delim CHAR(12),
	pos INT
)
RETURNS VARCHAR( 191 ) DETERMINISTIC
RETURN REPLACE(SUBSTRING(SUBSTRING_INDEX( source, delim, pos),
		LENGTH(SUBSTRING_INDEX( source, delim, pos -1)) + 1),
		delim, '')//

# RETURN MSG TIMESTAMP
CREATE FUNCTION fn_get_msg_time(
	msg_id VARCHAR( 191 )
) RETURNS BIGINT DETERMINISTIC
BEGIN
DECLARE msg_time BIGINT DEFAULT 0;
SELECT msg.timestamp INTO msg_time FROM message AS msg
	WHERE msg.msgId = msg_id
	LIMIT 1;

RETURN msg_time;
END//

#
#
CREATE PROCEDURE set_last_patch_version(
	IN `version` INT,
	IN `comment` VARCHAR( 191 )
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
# STATS
#

# return # of user-to-user connections for this user this day

CREATE PROCEDURE stats_user_relation_date(
	IN `fUserId` VARCHAR( 191 ),
	IN `date`    DATE
)
BEGIN
SELECT count(*) FROM user_relation AS ur
LEFT JOIN account AS a
ON a.clientId=ur.userId
WHERE a.fUserId=`fUserId`
AND DATE(ur.created)=DATE(`date`);
END//

# return # of people this user has sent a message to this day

CREATE PROCEDURE stats_user_chats_date(
	IN `fUserId` VARCHAR( 191 ),
	IN `date`    DATE
)
BEGIN
SELECT count(*) FROM user_relation AS ur
LEFT JOIN account AS a
ON a.clientId=ur.userId
WHERE a.fUserId=`fUserId`
AND ur.roomId IN (
	SELECT m.roomId FROM message AS m
	WHERE m.fromId=a.clientId
	AND DATE( FROM_UNIXTIME( m.timestamp / 1000 ))=DATE( `date` )
);
END//

#
# ACCOUNT
#

#
# CREATE
CREATE PROCEDURE account_create(
	IN `clientId`    VARCHAR( 191 ),
	IN `fUserId`     VARCHAR( 191 ),
	IN `fUsername`   VARCHAR( 191 ),
	IN `fLastUpdate` BIGINT,
	IN `fIsDisabled` BOOLEAN,
	IN `name`        VARCHAR( 191 ),
	IN `settings`    TEXT
)
BEGIN
	INSERT INTO `account` (
		`clientId`,
		`fUserId`,
		`fUsername`,
		`fLastUpdate`,
		`fIsDisabled`,
		`name`,
		`settings`
	) VALUES (
		`clientId`,
		`fUserId`,
		`fUsername`,
		`fLastUpdate`,
		`fIsDisabled`,
		`name`,
		`settings`
	);
	
	SELECT * FROM `account` AS a
	WHERE a.clientId = `clientId`;
END//

#
# SET FUSERID
CREATE PROCEDURE account_set_fuserid(
	IN `clientId` VARCHAR( 191 ),
	IN `fUserId`  VARCHAR( 191 )
)
BEGIN
UPDATE account AS a
SET a.fUserId = `fUserId`
WHERE a.clientId = `clientId`;

SELECT * FROM account
WHERE account.clientId = `clientId`;
END//

#
## READ BY ID
CREATE PROCEDURE account_read_id(
	IN `clientId` VARCHAR( 191 )
)
BEGIN
SELECT * FROM account
WHERE account.clientId = `clientId`;
END//

#
# READ BY FUSERID
CREATE PROCEDURE account_read_fuserid(
	IN `fUserId` VARCHAR( 191 )
)
BEGIN
	SELECT * FROM account
	WHERE account.fUserId = `fUserId`;
END//

#
# READ BY LOGIN ( legacy )
CREATE PROCEDURE account_read_fusername(
	IN `fUsername` VARCHAR( 191 )
)
BEGIN
	SELECT * FROM account
	WHERE account.fUsername = `fUsername`;
END//

#
#
CREATE PROCEDURE account_read_alphanum()
BEGIN
SELECT a.clientId FROM account AS a
ORDER BY a.name ASC;
END//

#
# SEARCH
CREATE PROCEDURE account_search(
	IN `needle` VARCHAR( 191 )
)
BEGIN
SELECT a.clientId FROM account AS a
WHERE a.name LIKE CONCAT( '%', `needle`, '%' );
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
	IN `clientId` VARCHAR( 191 )
)
BEGIN
	DELETE FROM account
	WHERE acount.clientId = `clientId`;
END//

#
# TOUCH
CREATE PROCEDURE account_touch(
	IN `clientId` VARCHAR( 191 )
)
BEGIN

UPDATE account 
SET lastLogin = NOW()
WHERE account.clientId = `clientId`;

END//

#
# SET PASS
CREATE PROCEDURE account_set_pass(
	IN `clientId` VARCHAR( 191 ),
	IN `pass`     TEXT
)
BEGIN

UPDATE account AS a
SET a.pass = `pass`
WHERE a.clientId = `clientId`;

END//

#
# UPDATE NAME
CREATE PROCEDURE account_update_name(
	IN `clientId` VARCHAR( 191 ),
	IN `name`     VARCHAR( 191 )
)
BEGIN

UPDATE account AS a
SET a.name = `name`
WHERE a.clientId = `clientId`;

END//

#
# UPDATE AVATAR
CREATE PROCEDURE account_update_avatar(
	IN `clientId` VARCHAR( 191 ),
	IN `avatar`   TEXT
)
BEGIN

UPDATE account AS a
SET a.avatar = `avatar`
WHERE a.clientId = `clientId`;

END//

#
# UPDATE FISDISABLED
CREATE PROCEDURE account_update_fisdisabled(
	IN `clientId`   VARCHAR( 191 ),
	IN `isDisabled` BOOLEAN
)
BEGIN

UPDATE account AS a
SET a.fIsDisabled = `isDisabled`
WHERE a.clientId = `clientId`;

END//

#
# UPDATE FLASTUPDATE
CREATE PROCEDURE account_update_flastupdate(
	IN `clientId`    VARCHAR( 191 ),
	IN `fLastUpdate` BIGINT
)
BEGIN

UPDATE account AS a
SET a.fLastUpdate = `fLastUpdate`
WHERE a.clientId = `clientId`;

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
	IN `clientId` VARCHAR( 191 ),
	IN `name` VARCHAR( 191 ),
	IN `ownerId` VARCHAR( 191 ),
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
# reads basic room data required to intialize a room in presence
CREATE PROCEDURE room_read(
	IN `clientId` VARCHAR( 191 )
)
BEGIN
	SELECT * FROM room
	WHERE room.clientId = `clientId`;
END//

#
# ROOM_READ_ALL
# collect all db data related to a room
CREATE PROCEDURE room_read_all(
	IN `clientId` VARCHAR( 191 )
)
BEGIN
# room
SELECT
	r.clientId,
	r.workgroupId,
	r.name,
	r.ownerId,
	r.settings,
	r.isPrivate,
	r.created,
	r.lastActivity
FROM room AS r
WHERE r.clientId = `clientId`;

# authorized
SELECT
	a.accountId
FROM authorized_for_room AS a
WHERE a.roomId = `clientId`;

# workgroups
SELECT wg.fId FROM workgroup_rooms AS wg
WHERE wg.roomId = `clientId`;

# invites
SELECT
	i.token,
	i.singleUse
FROM invite_token AS i
WHERE i.isValid = 1
AND i.roomId = `clientId`;

# messages
SELECT
	(
		SELECT COUNT(*) FROM message AS m
		WHERE m.roomId = `clientId`
	) AS 'total',
	(
		SELECT COUNT(*) FROM message_edit AS me
		LEFT JOIN message AS m ON me.msgId = m.msgId
		WHERE m.roomId = `clientId`
	) AS 'edits';

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
	IN `clientId` VARCHAR( 191 )
)
BEGIN
	DELETE FROM room
	WHERE room.clientId = `clientId`;
END//

#
# TOUCH
CREATE PROCEDURE room_touch(
	IN `clientId` VARCHAR( 191 )
)
BEGIN
	UPDATE room AS r
	SET r.lastActivity = NOW()
	WHERE r.clientId = `clientId`;
END//

#
# SET NAME
CREATE PROCEDURE room_set_name(
	IN `clientId` VARCHAR( 191 ),
	IN `name` VARCHAR( 191 )
)
BEGIN
UPDATE room AS r
SET r.name = `name`
WHERE r.clientId = `clientId`;
END//

#
# SET OWNER
CREATE PROCEDURE room_set_owner(
	IN `clientId` VARCHAR( 191 ),
	IN `ownerId` VARCHAR( 191 )
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
	IN `roomId` VARCHAR( 191 )
)
BEGIN
SELECT 
	a.clientId,
	a.fIsDisabled
FROM `authorized_for_room` AS auth 
LEFT JOIN `account` AS a 
ON auth.accountId = a.clientId 
WHERE auth.roomId = `roomId`;
END//

#
# load rooms available for an account
CREATE PROCEDURE auth_get_for_account(
	IN `accountId` VARCHAR( 191 )
)
BEGIN
SELECT r.clientId FROM `authorized_for_room` AS auth 
LEFT JOIN `room` AS r 
ON auth.roomId = r.clientId 
WHERE auth.accountId = `accountId`
AND r.isPrivate = 0;
END//

#
# load rooms for workgroups
CREATE PROCEDURE auth_get_for_workgroups(
	IN `accountId` VARCHAR( 191 ),
	IN `fIds`      TEXT
)
BEGIN
	DECLARE i INT DEFAULT 0;
	DECLARE str VARCHAR( 191 );
	DROP TEMPORARY TABLE IF EXISTS str_split_tmp;
	CREATE TEMPORARY TABLE str_split_tmp( `id` VARCHAR( 191));
	loopie: LOOP
		SET i=i+1;
		SET str=fn_split_str( fIds, '|', i );
		IF str='' THEN
			LEAVE loopie;
		END IF;
		INSERT INTO str_split_tmp VALUES( str );
	END LOOP loopie;
	
	SELECT
		r.clientId,
		wgr.fId
	FROM `workgroup_rooms` as wgr
	LEFT JOIN `room` AS r
	ON wgr.roomId = r.clientId
	WHERE wgr.fId IN (
		SELECT id FROM str_split_tmp
	)
	AND wgr.roomId NOT IN (
		SELECT afr.roomId FROM `authorized_for_room` AS afr
		WHERE afr.accountId=`accountId`
	);
END//

#
# room_get_assigned_workgroups
CREATE PROCEDURE room_get_assigned_workgroups(
	IN `roomId` VARCHAR( 191 )
)
BEGIN
SELECT
	wgr.fId,
	wgr.setById,
	wgr.setTime
FROM `workgroup_rooms` AS wgr
WHERE wgr.roomId = `roomId`;
END//

#
# room_assign_workgroup
CREATE PROCEDURE room_assign_workgroup(
	IN `roomId`  VARCHAR( 191 ),
	IN `fId`     VARCHAR( 191 ),
	IN `setById` VARCHAR( 191 )
)
BEGIN
INSERT INTO `workgroup_rooms` (
	`fId`,
	`roomId`,
	`setById`
)
VALUES (
	`fId`,
	`roomId`,
	`setById`
);

SELECT
	wgr.fId,
	wgr.roomId,
	wgr.setById,
	wgr.setTime
FROM `workgroup_rooms` AS wgr
WHERE wgr.roomId = `roomId`
AND wgr.fId = `fId`;
END//

#
# room_dismiss_workgroup
CREATE PROCEDURE room_dismiss_workgroup(
	IN `roomId` VARCHAR( 191 ),
	IN `fId`    VARCHAR( 191 )
)
BEGIN
DELETE wgr FROM `workgroup_rooms` AS wgr
WHERE wgr.roomId = `roomId`
AND wgr.fId = `fId`;

SELECT `fId` as 'fId', ROW_COUNT() as 'removed';
END//

#
# room get assigned to
CREATE PROCEDURE room_get_assigned_to(
	IN `worgId` VARCHAR( 191 )
)
BEGIN
SELECT r.roomId FROM workgroup_rooms AS r
WHERE r.fId = `worgId`;

END//

#
# room create for workgroup
CREATE PROCEDURE room_create_for_workgroup(
	IN `clientId`    VARCHAR( 191 ),
	IN `workgroupId` VARCHAR( 191 ),
	IN `name`        VARCHAR( 191 ),
	IN `ownerId`     VARCHAR( 191 ),
	IN `settings`    TEXT
)
BEGIN
INSERT INTO `room` (
	`clientId`,
	`workgroupId`,
	`name`,
	`ownerId`,
	`settings`,
	`isPrivate`
) VALUES (
	`clientId`,
	`workgroupId`,
	`name`,
	`ownerId`,
	`settings`,
	0
);

SELECT * FROM `room`
WHERE room.workgroupId = `workgroupId`;
END//

#
# room get for workgroup
CREATE PROCEDURE room_get_for_workgroup(
	IN `workgroupId` VARCHAR( 191 )
)
BEGIN
SELECT * FROM `room` AS r
WHERE r.workgroupId = `workgroupId`;
END//

#
# set auths for a room
CREATE PROCEDURE auth_add(
	IN `roomId`      VARCHAR( 191 ),
	IN `accIdsDelim` TEXT
)
BEGIN
	DECLARE i INT DEFAULT 0;
	DECLARE str VARCHAR( 191 );
	DROP TEMPORARY TABLE IF EXISTS str_split_tmp;
	CREATE TEMPORARY TABLE str_split_tmp( `str` VARCHAR( 191 ));
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
# CHECK ACCOUNT IS AUTHED
CREATE PROCEDURE auth_check(
	IN `roomId`    VARCHAR( 191 ),
	IN `accountId` VARCHAR( 191 )
)
BEGIN
SELECT a.accountId FROM `authorized_for_room` AS a
WHERE a.roomId = `roomId`
AND a.accountId = `accountId`;
END//

#
# REMOVE ACCOUNT FROM ROOM
CREATE PROCEDURE auth_remove(
	IN `roomId` VARCHAR( 191 ),
	IN `accountId` VARCHAR( 191 )
)
BEGIN
DELETE afr FROM authorized_for_room AS afr
WHERE afr.roomId = `roomId` AND afr.accountId = `accountId`;
END//

#
# USER RELATION
#

#
# USER_RELATION_CREATE
CREATE PROCEDURE user_relation_create(
	IN `relationId` VARCHAR( 191 ),
	IN `accountA`   VARCHAR( 191 ),
	IN `accountB`   VARCHAR( 191 ),
	IN `roomId`     VARCHAR( 191 )
)
BEGIN
INSERT INTO `user_relation` (
	`relationId`,
	`userId`,
	`contactId`,
	`roomId`
) VALUES (
	`relationId`,
	`accountA`,
	`accountB`,
	`roomId`
);

INSERT INTO `user_relation` (
	`relationId`,
	`userId`,
	`contactId`,
	`roomId`
) VALUES (
	`relationId`,
	`accountB`,
	`accountA`,
	`roomId`
);

SELECT * FROM user_relation AS r
WHERE ( r.userId = `accountA` AND r.contactId = `accountB` )
OR ( r.userId = `accountB` AND r.contactId = `accountA` );
END//

#
# USER_RELATION_ASSIGN_ROOM
CREATE PROCEDURE user_relation_assign_room(
	IN `relationId` VARCHAR( 191 ),
	IN `roomId`     VARCHAR( 191 )
)
BEGIN
UPDATE user_relation AS ur
SET ur.roomId = `roomId`
WHERE ur.relationId = `relationId`;
END//

#
# USER_RELATION_GET
CREATE PROCEDURE user_relation_read(
	IN `accountA` VARCHAR( 191 ),
	IN `accountB` VARCHAR( 191 )
)
BEGIN
SELECT * FROM user_relation AS r
WHERE ( r.userId = `accountA` AND r.contactId = `accountB` )
OR ( r.userId = `accountB` AND r.contactId = `accountA` );
END//

#
# USER_RELATION_GET_FOR_USER
CREATE PROCEDURE user_relation_read_all_for(
	IN `accountId`    VARCHAR( 191 ),
	IN `loadDisabled` BOOLEAN
)
BEGIN
SELECT
	r.relationId,
	r.userId,
	r.contactId,
	r.roomId,
	r.created,
	r.lastReadId,
	r.lastMsgId,
	c.fIsDisabled
FROM user_relation AS r
LEFT JOIN account AS c
	ON r.contactId = c.clientId
WHERE r.userId = `accountId`
AND
(
	( 0 = `loadDisabled` AND
		(
			0    = c.fIsDisabled OR
			c.fIsDisabled IS NULL
		)
	) OR
	( 1 = `loadDisabled` AND 1 )
);
END//

#
# USER_RELATION_STATE
CREATE PROCEDURE user_relation_state(
	IN `relationId` VARCHAR( 191 ),
	IN `contactId`  VARCHAR( 191 )
)
BEGIN
DECLARE room_id VARCHAR( 191 );
DECLARE last_read_id VARCHAR( 191 );

SELECT
	tur.roomId,
	tur.lastReadId
INTO
	room_id,
	last_read_id
FROM user_relation AS tur
WHERE
	tur.relationId = `relationId`
	AND tur.contactId = `contactId`;

SELECT count(*) AS `unreadMessages` FROM message AS m
WHERE m.roomId = room_id
AND m.fromId = contactId
AND m.timestamp > fn_get_msg_time( last_read_id );

SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM message AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
WHERE m.msgId = (
	SELECT ur.lastMsgId FROM user_relation AS ur
	WHERE
		ur.relationId = `relationId`
		AND ur.contactId = `contactId`
);

END//

#
# USER RELATION MESSAGES
CREATE PROCEDURE user_relation_messages(
	IN `relationId` VARCHAR( 191 )
)
BEGIN

SELECT
	ur.lastMsgId,
	lm.fromId AS 'lastMsgFrom'
FROM user_relation AS ur
LEFT JOIN message AS lm
	ON ur.lastMsgId = lm.msgId
WHERE ur.relationId = `relationId`
LIMIT 1;

SELECT
	ur.userId,
	ur.lastReadId,
	ur.lastReadTime
FROM user_relation AS ur
WHERE ur.relationId = `relationId`;

END//

#
# USER RELATION UPDATE LAST READ
CREATE PROCEDURE user_relation_update_last_read(
	IN `relationId` VARCHAR( 191 ),
	IN `userId`     VARCHAR( 191 ),
	IN `lastReadId` VARCHAR( 191 ),
	IN `timestamp`  BIGINT
)
required_label:BEGIN
DECLARE update_msg_id VARCHAR( 191 );
DECLARE has_read_last VARCHAR( 191 );

# return early on invalid msg id or sender trying to confirm his own message
SELECT m.msgId INTO update_msg_id
FROM message AS m
WHERE
	m.msgId = `lastReadId`
	AND m.fromId != `userId`;

IF ( update_msg_id IS NULL ) THEN
	LEAVE required_label;
END IF;

# return early if shownTime is already set
SELECT ur.lastReadId INTO has_read_last
FROM user_relation AS ur
WHERE
	ur.relationId = `relationId`
	AND ur.userId = `userId`
	AND ur.lastReadId = ur.lastMsgId;
#	AND ( fn_get_msg_time( update_msg_id ) > ( fn_get_msg_time( ur.lastReadId ));

IF ( has_read_last IS NOT NULL ) THEN
	LEAVE required_label;
END IF;

UPDATE user_relation AS ur
SET
	ur.lastReadId = `lastReadId`,
	ur.lastReadTime = `timestamp`
WHERE
	ur.relationId = `relationId`
	AND ur.userId = `userId`;

SELECT
	ur.userId,
	ur.contactId AS 'fromId',
	ur.lastReadId AS 'msgId',
	ur.lastReadTime
FROM user_relation AS ur
WHERE
	ur.relationId = `relationId`
	AND ur.userId = `userId`;

END//


# user_relation_update_messages
CREATE PROCEDURE user_relation_update_messages(
	IN `msgId`      VARCHAR( 191 ),
	IN `relationId` VARCHAR( 191 ),
	IN `fromId`     VARCHAR( 191 ),
	IN `toId`       VARCHAR( 191 ),
	IN `timestamp`  BIGINT
)
BEGIN
UPDATE user_relation AS ur
SET
	ur.lastMsgId = `msgId`
WHERE ur.relationId = `relationId`;

# update from
#UPDATE user_relation AS ur_t
#SET
#	ur_t.lastReadId = `msgId`,
#	ur_t.lastReadTime = `timestamp`
#WHERE
#	ur_t.relationId = `relationId`
#	AND ur_t.userId = `fromId`;

END//


#
# MESSAGE
#

#
# message_set
CREATE PROCEDURE message_set(
	IN `msgId`     VARCHAR( 191 ),
	IN `roomId`    VARCHAR( 191 ),
	IN `fromId`    VARCHAR( 191 ),
	IN `timestamp` BIGINT,
	IN `type`      VARCHAR( 20 ),
	IN `name`      VARCHAR( 191 ),
	IN `message`   TEXT
)
BEGIN
INSERT INTO `message` (
	`msgId`,
	`roomId`,
	`fromId`,
	`timestamp`,
	`type`,
	`name`,
	`message`,
	`status`
) VALUES (
	`msgId`,
	`roomId`,
	`fromId`,
	`timestamp`,
	`type`,
	`name`,
	`message`,
	""
);
END//


# message_set_work_target
CREATE PROCEDURE message_set_work_target(
	IN `msgId` VARCHAR( 191 ),
	IN `source` VARCHAR( 191 ),
	IN `target` VARCHAR( 191 ),
	IN `memberId` VARCHAR( 191 )
)
BEGIN
INSERT INTO `message_work_target` (
	`msgId`,
	`source`,
	`target`,
	`memberId`
) VALUES (
	`msgId`,
	`source`,
	`target`,
	`memberId`
);
END//


# messge_get_by_id
CREATE PROCEDURE message_get_by_id(
	IN `msgId`  VARCHAR( 191 )
)
BEGIN
SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM message AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
WHERE m.msgId = `msgId`;
END//

# message_get_desc
CREATE PROCEDURE message_get_desc(
	IN `roomId` VARCHAR( 191 ),
	IN `length` INT
)
BEGIN
SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM (
	SELECT * FROM message AS t
	WHERE t.roomId = `roomId`
	AND ( t.status is null OR t.status != "delete" )
	ORDER BY t._id DESC
	LIMIT 0, `length`
) AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
ORDER BY m._id ASC;

END//

# message_get_asc
CREATE PROCEDURE message_get_asc(
	IN `roomId` VARCHAR( 191 ),
	IN `length` INT
)
BEGIN
SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM (
	SELECT * FROM message AS t
	WHERE t.roomId = `roomId`
	AND ( t.status is null OR t.status != "delete" )
	ORDER BY t._id ASC
	LIMIT 0, `length`
) AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId;

END//

#mesage_get_after
CREATE PROCEDURE message_get_after(
	IN `roomId`    VARCHAR( 191 ),
	IN `fromTime`  BIGINT,
	IN `length`    INT,
	IN `incDelete` BOOL
)
BEGIN
SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM (
	SELECT * FROM message AS t
	WHERE t.roomId = `roomId`
	AND (
			( 0 = incDelete AND ( t.status is null OR t.status != "delete" ))
			OR
			( 1 = incDelete )
		)
	AND t.timestamp >= `fromTime`
	ORDER BY t._id ASC
	LIMIT `length`
) AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId;

END//

# message_get_before
CREATE PROCEDURE message_get_before(
	IN `roomId`    VARCHAR( 191 ),
	IN `toTime`    BIGINT,
	IN `length`    INT,
	IN `incDelete` BOOL
)
BEGIN
SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM (
	SELECT * FROM message AS t
	WHERE t.roomId = `roomId`
	AND (
			( 0 = incDelete AND ( t.status is null OR t.status != "delete" ))
			OR
			( 1 = incDelete )
		)
	AND t.timestamp < `toTime`
	ORDER BY t._id DESC
	LIMIT `length`
) AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
ORDER BY m._id ASC;

END//

# message get with work targets
CREATE PROCEDURE message_get_with_work_targets(
	IN `msgId` VARCHAR( 191 )
)
BEGIN
SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM message AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
WHERE m.msgId = `msgId`;
	
SELECT
	t.msgId,
	t.source,
	t.target,
	t.memberId
FROM message_work_target AS t
WHERE t.msgId = `msgId`;

END//

# message_get_work_targets_after
CREATE PROCEDURE message_get_work_targets_after(
	IN `workgroup` VARCHAR( 191 ),
	IN `from`      BIGINT,
	IN `length`    INT
)
BEGIN
DROP TABLE IF EXISTS tmp;
CREATE TEMPORARY TABLE tmp (
SELECT
	t.msgId,
	t.source,
	t.target,
	t.memberId
FROM `message_work_target` AS t
	LEFT JOIN `message` AS mt
	ON t.msgId = mt.msgId
WHERE mt.timestamp >= `from`
AND ( mt.status is null OR mt.status != "delete" )
AND ( t.source = `workgroup` OR t.target = `workgroup` )
ORDER BY mt.timestamp ASC
);

SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS 'time',
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS 'message',
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS 'editReason'
FROM message AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
WHERE m.msgId IN (
	SELECT M.msgId FROM message AS M
	RIGHT JOIN tmp AS T
		ON M.msgId = T.msgId
	GROUP BY M.msgId
);

SELECT * FROM tmp;

END//

# message_get_work_targets_before
CREATE PROCEDURE message_get_work_targets_before(
	IN `workgroup` VARCHAR( 191 ),
	IN `to`        BIGINT,
	IN `length`    INT
)
BEGIN
DROP TABLE IF EXISTS tmp;
CREATE TEMPORARY TABLE tmp (
SELECT
	t.msgId,
	t.source,
	t.target,
	t.memberId
FROM `message_work_target` AS t
	LEFT JOIN `message` AS mt
	ON t.msgId = mt.msgId
WHERE mt.timestamp < `to`
AND ( mt.status is null OR mt.status != "delete" )
AND ( t.source = `workgroup` OR t.target = `workgroup` )
ORDER BY mt.timestamp DESC
);

SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM message AS m 
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
WHERE m.msgId IN (
	SELECT M.msgId FROM `message` AS M
	RIGHT JOIN tmp AS T
		ON M.msgId = T.msgId
	GROUP BY M.msgId
);

SELECT * FROM tmp;

END//

# message_get_work_targets_between
CREATE PROCEDURE message_get_work_targets_between(
	IN `workgroup` VARCHAR( 191 ),
	IN `from`      BIGINT,
	IN `to`        BIGINT
)
BEGIN
DROP TABLE IF EXISTS tmp;
CREATE TEMPORARY TABLE tmp (
SELECT
	t.msgId,
	t.source,
	t.target,
	t.memberId
FROM `message_work_target` AS t
	LEFT JOIN `message` AS mt
	ON t.msgId = mt.msgId
WHERE mt.timestamp >= `from`
AND mt.timestamp <= `to`
AND ( mt.status is null OR mt.status != "delete" )
AND ( t.source = `workgroup` OR t.target = `workgroup` )
ORDER BY mt.timestamp ASC
);

SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS 'time',
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS 'message',
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS 'editReason'
FROM message AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
WHERE m.msgId IN (
	SELECT M.msgId FROM message AS M
	RIGHT JOIN tmp AS T
		ON M.msgId = T.msgId
	GROUP BY M.msgId
);

SELECT * FROM tmp;

END//

# message_get_before_view
CREATE PROCEDURE message_get_for_view(
	IN `worgId` VARCHAR( 191 ),
	IN `userId` VARCHAR( 191 ),
	IN `to`     BIGINT,
	IN `from`   BIGINT,
	IN `limit`  INT
)
BEGIN
DROP TABLE IF EXISTS tmp;
CREATE TEMPORARY TABLE tmp (
SELECT
	T.msgId
FROM (
	SELECT
		t.msgId,
		m.timestamp
	FROM message_work_target AS t
	LEFT JOIN message AS m
		ON t.msgId = m.msgId
	WHERE ( m.status is null OR m.status != "delete" )
	AND (
			( `to` IS NOT NULL AND m.timestamp < `to` )
			OR
			( `from` IS NOT NULL AND m.timestamp > `from` )
		  )
	  AND (
			( t.target = `worgId` AND m.fromId = `userId` )
			OR
			( t.source = `worgId` AND t.memberId = `userId` )
		  )
	GROUP BY t.msgId
	ORDER BY m.timestamp DESC
	#LIMIT `limit`
) AS T );

SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS 'time',
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS 'message',
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS 'editReason'
FROM message AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
WHERE m.msgId IN (
	SELECT tmp.msgId FROM tmp
)
ORDER BY m.timestamp ASC;

SELECT
	t.msgId,
	t.source,
	t.target,
	t.memberId
FROM message_work_target AS t
WHERE t.msgId IN (
	SELECT tmp.msgId FROM tmp
);


END//

# RETURN ID OF LAST MSG EDIT
#CREATE FUNCTION fn_get_last_edit(
#	msg_id VARCHAR( 191 )
#) RETURNS TEXT DETERMINISTIC
#BEGIN
#DECLARE edit TEXT DEFAULT NULL;
#SELECT e.message INTO edit FROM message_edit AS e
#	WHERE e.msgId = msg_id
#	GROUP BY e.msgId
#	ORDER BY e.editTime DESC
#	LIMIT 1;
#
#RETURN edit;
#END//

# message_update
CREATE PROCEDURE message_update(
	IN `msgId` VARCHAR( 191 ),
	IN `update` TEXT
)
BEGIN

UPDATE message AS m
SET
	m.message = `update`
WHERE m.msgId = `msgId`;

SELECT
	m.msgId,
	m.roomId,
	m.fromId,
	m.timestamp AS `time`,
	m.type,
	m.name,
	COALESCE( e.message, m.message ) AS `message`,
	m.statusId,
	m.status,
	m.editId,
	e.editBy,
	e.editTime,
	e.reason AS `editReason`
FROM message AS m
LEFT JOIN message_edit AS e
	ON m.editId = e.clientId
WHERE m.msgId = `msgId`;

END//

# message_set_edit
CREATE PROCEDURE message_set_edit(
	IN `clientId` VARCHAR( 191 ),
	IN `msgId`    VARCHAR( 191 ),
	IN `editBy`   VARCHAR( 191 ),
	IN `editTime` BIGINT,
	IN `reason`   TEXT,
	IN `message`  TEXT
)
BEGIN
INSERT INTO message_edit (
	`clientId`,
	`msgId`,
	`editBy`,
	`editTime`,
	`reason`,
	`message`
) VALUES (
	`clientId`,
	`msgId`,
	`editBy`,
	`editTime`,
	`reason`,
	`message`
);

UPDATE message AS m
SET m.editId = `clientId`
WHERE m.msgId = `msgId`;

SELECT * FROM message_edit AS e
WHERE e.msgId = `msgId`
ORDER BY e.editTime DESC
LIMIT 1;

END//

# message_set_status
CREATE PROCEDURE message_set_status(
	IN `status`   VARCHAR( 20 ),
	IN `statusId` VARCHAR( 191 ),
	IN `msgId`    VARCHAR( 191 ),
	IN `setBy`    VARCHAR( 191 ),
	IN `setTime`  BIGINT,
	IN `reason`   TEXT,
	IN `message`  TEXT
)
BEGIN
INSERT INTO message_status (
	`status`,
	`clientId`,
	`msgId`,
	`setBy`,
	`setTime`,
	`reason`,
	`message`
) VALUES (
	`status`,
	`statusId`,
	`msgId`,
	`setBy`,
	`setTime`,
	`reason`,
	`message`
);

UPDATE message AS m 
SET 
	m.status = `status`,
	m.statusId = `statusId`
WHERE m.msgId = `msgId`;

CALL message_get_by_id( `msgId` );

END//

# room_user_messages_set
CREATE PROCEDURE room_user_messages_set(
	IN `roomId` VARCHAR( 191 ),
	IN `userId` VARCHAR( 191 )
)
BEGIN

SELECT m.msgId
INTO @lastMsg 
FROM message AS m
WHERE m.roomId = `roomId`
AND ( m.status is null OR m.status!="delete" )
ORDER BY m._id DESC
LIMIT 1;

INSERT INTO room_user_messages (
	`userId`,
	`roomId`,
	`lastReadId`
) VALUES (
	`userId`,
	`roomId`,
	@lastMsg
);

SELECT
	rum.roomId,
	rum.userId,
	rum.lastReadId
FROM room_user_messages AS rum
WHERE
	rum.roomId = `roomId` AND
	rum.userId = `userId`;
	
END//


# room_user_messages_load
CREATE PROCEDURE room_user_messages_load(
	IN `roomId` VARCHAR( 191 )
)
BEGIN
SELECT
	rum.userId
FROM room_user_messages AS rum
WHERE rum.roomId = `roomId`;
END//


CREATE PROCEDURE room_user_messages_update(
	IN `roomId`   VARCHAR( 191 ),
	IN `userList` TEXT,
	IN `msgId`    VARCHAR( 191 )
)
BEGIN
DECLARE i INT DEFAULT 0;
DECLARE str VARCHAR( 191 );
DROP TEMPORARY TABLE IF EXISTS str_split_tmp;
CREATE TEMPORARY TABLE str_split_tmp( `id` VARCHAR( 191));
loopie: LOOP
	SET i=i+1;
	SET str=fn_split_str( `userList`, '|', i );
	IF str='' THEN
		LEAVE loopie;
	END IF;
	INSERT INTO str_split_tmp VALUES( str );
END LOOP loopie;

UPDATE room_user_messages AS rum
SET rum.lastReadId = `msgId`
WHERE
	rum.roomId = `roomId` AND
	rum.userId IN ( SELECT id FROM str_split_tmp );

END//


# room_user_messages_count_unread
CREATE PROCEDURE room_user_messages_count_unread(
	IN  `roomId` VARCHAR( 191 ),
	IN  `userId` VARCHAR( 191 )
)
BEGIN
DECLARE lastReadId VARCHAR( 191 );
DECLARE lastReadTime BIGINT;
#DECLARE unread INT;
SELECT COALESCE(
( 
	SELECT m.timestamp FROM room_user_messages AS rum
	LEFT JOIN message AS m 
		ON rum.lastReadId = m.msgId
	WHERE rum.roomId = `roomId`
	AND rum.userId = `userId`
)
, 0 ) 
INTO lastReadTime;

SELECT COUNT(*) AS 'unread'
FROM message AS m
WHERE m.roomId = `roomId`
AND ( m.status is null OR m.status!="delete" )
AND	m.timestamp > lastReadTime;

END//


# room_user_messages_count_unread_worg
CREATE PROCEDURE room_user_messages_count_unread_worg(
	IN `roomId`       VARCHAR( 191 ),
	IN `userId`       VARCHAR( 191 ),
	IN `worgId`       VARCHAR( 191 ),
	IN `noPrivate`    BOOLEAN,
	IN `userIsViewer` BOOLEAN
)
BEGIN

# get timestamp ( TODO refactor to store timestamp in the first place )
DECLARE lastReadTime BIGINT;
SELECT
	m.timestamp
INTO
	lastReadTime
FROM room_user_messages AS u
LEFT JOIN message AS m ON
	u.lastReadId = m.msgId
WHERE
	u.roomId = `roomId` AND
	u.userId = `userId`;

#
SELECT
	COUNT(*) AS 'unread'
FROM message AS m
WHERE
	( m.status is null OR m.status!="delete" )
AND
	m.timestamp > lastReadTime
AND
	m.fromId != `userId`
AND
	(
		( 0 = `userIsViewer` AND (
			( m.roomId = `roomId` AND m.type = 'msg' )
			OR
			m.msgId IN (
				SELECT t.msgId FROM message_work_target AS t
				WHERE t.target = `worgId` AND (
					( 1 = `noPrivate` AND ( t.memberId IS NULL ))
					OR
					( 0 = `noPrivate` AND ( t.memberId = `userId` ))
				)
			)
		))
		OR
		( 1 = `userIsViewer` AND (
			m.msgId IN (
				SELECT t.msgId FROM message_work_target AS t
				WHERE (
					t.source = `worgId` OR 
					t.target = `worgId`
				) AND (
					m.fromId = `userId` OR
					t.memberId = `userId`
				)
			)
		))
	);

END//


## INVITE TOENS

# invite_set;
CREATE PROCEDURE invite_set(
	IN `type`      VARCHAR( 191 ),
	IN `token`     VARCHAR( 191 ),
	IN `roomId`    VARCHAR( 191 ),
	IN `singleUse` BOOLEAN,
	IN `targetId`  VARCHAR( 191 ),
	IN `createdBy` VARCHAR( 191 )
)
BEGIN
INSERT INTO `invite_token` (
	`type`,
	`token`,
	`roomId`,
	`singleUse`,
	`targetId`,
	`createdBy`
) VALUES (
	type,
	token,
	roomId,
	singleUse,
	targetId,
	createdBy
);
END//


# invite_get
CREATE PROCEDURE invite_get(
	IN `token` VARCHAR( 191 )
)
BEGIN

SELECT * FROM invite_token AS inv
WHERE iv.token = token;

END//


# invite_get_room
CREATE PROCEDURE invite_get_room(
	IN `roomId` VARCHAR( 191 )
)
BEGIN

SELECT * FROM invite_token AS inv
WHERE inv.roomId = roomId
AND inv.type = 'public'
AND inv.isValid = 1;

END//

#invite_get_target
CREATE PROCEDURE invite_get_target(
	IN `targetId` VARCHAR( 191 )
)
BEGIN

SELECT
	i.type,
	i.token,
	i.roomId,
	i.targetId,
	i.createdBy,
	i.created
FROM invite_token AS i
WHERE i.targetId = `targetId`
AND i.isValid = 1;

END//

#invite_check_exists
CREATE PROCEDURE invite_check_exists(
	IN `targetId` VARCHAR( 191 ),
	IN `roomId` VARCHAR( 191 )
)
BEGIN

SELECT i.token, i.targetId, i.roomId, i.isValid FROM invite_token AS i
WHERE i.targetId = `targetId`
AND i.roomId = `roomId`
AND i.isValid = 1;

END//

# invite_check_room
CREATE PROCEDURE invite_check_room(
	IN `token` VARCHAR( 191 ),
	IN `roomId` VARCHAR( 191 )
)
BEGIN
SELECT * FROM invite_token AS inv
WHERE inv.token = token
AND inv.roomId = roomId;
END//

# invite_invalidate;
CREATE PROCEDURE invite_invalidate(
	IN `token` VARCHAR( 191 ),
	IN `invalidated_by` VARCHAR( 191 )
)
BEGIN
	UPDATE invite_token AS inv
	SET
		inv.isValid = 0,
		inv.invalidatedBy = invalidated_by,
		inv.invalidated = NOW()
	WHERE inv.token = token;
END//

#DROP PROCEDURE IF EXISTS invite_used;

# ACCOUNT
# GET SETTINGS
CREATE PROCEDURE account_settings_get(
	IN `clientId` VARCHAR( 191 )
)
BEGIN
SELECT a.settings FROM account AS a
WHERE a.clientId = `clientId`;
END//

#
# GET SETTING BY KEY
CREATE PROCEDURE account_settings_get_by_key(
	IN `clientId` VARCHAR( 191 ),
	IN `key`      VARCHAR( 191 )
)
BEGIN
SET @path = CONCAT( "$.", `key` );
SELECT JSON_EXTRACT( a.settings, @path ) AS "value" FROM account AS a
WHERE a.clientId = `clientId`;
END//

#
# SET SETTING KEY VALUE
CREATE PROCEDURE account_settings_set_key_value(
	IN `clientId` VARCHAR( 191 ),
	IN `key`      VARCHAR( 191 ),
	IN `jsonStr`  VARCHAR( 191 )
)
BEGIN
SET @path = CONCAT( "$.", `key` );
UPDATE account AS a
SET a.settings = JSON_SET(
	a.settings,
	@path,
	JSON_EXTRACT( jsonStr, @path )
) WHERE a.clientId = `clientId`;
END//

#
# REMOVE SETTING
CREATE PROCEDURE account_settings_remove_key(
	IN `clientId` VARCHAR( 191 ),
	IN `key`      VARCHAR( 191 )
)
BEGIN
SET @path = CONCAT( "$.", `key` );
UPDATE account AS a
SET a.settings = JSON_REMOVE(
	a.settings,
	@path
) WHERE a.clientId = `clientId`;
END//


# ROOM
# GET SETTINGS
CREATE PROCEDURE room_settings_get(
	IN `clientId` VARCHAR( 191 )
)
BEGIN
SELECT r.settings FROM room AS r
WHERE r.clientId = `clientId`;
END//

#
# GET SETTING BY KEY
CREATE PROCEDURE room_settings_get_by_key(
	IN `clientId` VARCHAR( 191 ),
	IN `key`      VARCHAR( 191 )
)
BEGIN
SET @path = CONCAT( "$.", `key` );
SELECT JSON_EXTRACT( r.settings, @path ) AS "value" FROM room AS r
WHERE r.clientId = `clientId`;
END//

#
# SET SETTING KEY VALUE
CREATE PROCEDURE room_settings_set_key_value(
	IN `clientId` VARCHAR( 191 ),
	IN `key`      VARCHAR( 191 ),
	IN `jsonStr`  VARCHAR( 191 )
)
BEGIN
SET @path = CONCAT( "$.", `key` );
UPDATE room AS r
SET r.settings = JSON_SET(
	r.settings,
	@path,
	JSON_EXTRACT( jsonStr, @path )
) WHERE r.clientId = `clientId`;
END//

#
# REMOVE SETTING
CREATE PROCEDURE room_settings_remove_key(
	IN `clientId` VARCHAR( 191 ),
	IN `key`      VARCHAR( 191 )
)
BEGIN
SET @path = CONCAT( "$.", `key` );
UPDATE room AS r
SET r.settings = JSON_REMOVE(
	r.settings,
	@path
) WHERE r.clientId = `clientId`;
END//

