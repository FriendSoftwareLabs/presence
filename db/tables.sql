# !!!
# !!! REMEBER TO UPDATE TABLE VERSION, OR THE PATCHER WILL CRASH
# !!!

ALTER DATABASE CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `invite_token_used`;
DROP TABLE IF EXISTS `invite_token`;
DROP TABLE IF EXISTS `workgroup_rooms`;
DROP TABLE IF EXISTS `room_user_messages`;
DROP TABLE IF EXISTS `user_relation`;
DROP TABLE IF EXISTS `authorized_for_room`;
DROP TABLE IF EXISTS `message`;
DROP TABLE IF EXISTS `account`;
DROP TABLE IF EXISTS `room`;
DROP TABLE IF EXISTS `db_history`;

CREATE TABLE `account` (
	`_id`        INT UNSIGNED NOT NULL auto_increment,
	`clientId`   VARCHAR( 191 ) NOT NULL UNIQUE,
	`fUserId`    VARCHAR( 191 ) NULL,
	`fUsername`  VARCHAR( 191 ) NOT NULL UNIQUE,
	`name`       VARCHAR( 191 ) NOT NULL,
	`avatar`     TEXT,
	`settings`   JSON NOT NULL,
	`active`     BOOLEAN NOT NULL DEFAULT 1,
	`created`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`lastLogin`  TIMESTAMP NULL,
	`lastOnline` TIMESTAMP NULL,
	PRIMARY KEY( _id )
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `room` (
	`_id`          INT UNSIGNED NOT NULL auto_increment,
	`clientId`     VARCHAR( 191 ) NOT NULL UNIQUE,
	`workgroupId`  VARCHAR( 191 ) NULL UNIQUE,
	`name`         VARCHAR( 191 ) NOT NULL,
	`ownerId`      VARCHAR( 191 ) NOT NULL,
	`settings`     JSON NOT NULL,
	`isPrivate`    BOOLEAN NOT NULL DEFAULT 1,
	`created`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`lastActivity` TIMESTAMP NULL,
	PRIMARY KEY( _id )
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `authorized_for_room` (
	`_id`       INT UNSIGNED NOT NULL auto_increment,
	`roomId`    VARCHAR( 191 ) NOT NULL,
	`accountId` VARCHAR( 191 ) NOT NULL,
	PRIMARY KEY( _id ),
	UNIQUE KEY( roomId, accountId ),
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( accountId ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `workgroup_rooms` (
	`_id`     INT UNSIGNED NOT NULL auto_increment,
	`fId`     VARCHAR( 191 ) NOT NULL,
	`roomId`  VARCHAR( 191 ) NOT NULL,
	`setById` VARCHAR( 191 ) NOT NULL,
	`setTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY( _id ),
	UNIQUE KEY( fId, roomId ),
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( setById ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `message` (
	`_id`       INT UNSIGNED NOT NULL auto_increment,
	`msgId`     VARCHAR( 191 ) NOT NULL UNIQUE,
	`roomId`    VARCHAR( 191 ) NOT NULL,
	`fromId`    VARCHAR( 191 ),
	`timestamp` BIGINT NOT NULL,
	`type`      VARCHAR( 20 ) NOT NULL,
	`name`      VARCHAR( 191 ),
	`message`   TEXT NOT NULL,
	`editId`    VARCHAR( 191 ),
	PRIMARY KEY( _id ),
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY ( fromId ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `message_work_target` (
	`_id`         INT UNSIGNED NOT NULL auto_increment,
	`msgId`       VARCHAR( 191 ) NOT NULL,
	`source`      VARCHAR( 191 ) NOT NULL,
	`target`      VARCHAR( 191 ) NOT NULL,
	`memberId`    VARCHAR( 191 ) NULL,
	PRIMARY KEY( _id ),
	FOREIGN KEY( msgId ) REFERENCES message( msgId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( memberId ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `message_edit` (
	`_id`       INT UNSIGNED NOT NULL auto_increment,
	`clientId`  VARCHAR( 191 ) NOT NULL UNIQUE,
	`msgId`     VARCHAR( 191 ) NOT NULL,
	`editBy`    VARCHAR( 191 ),
	`editTime`  BIGINT NOT NULL,
	`reason`    TEXT,
	`message`   TEXT NOT NULL,
	PRIMARY KEY( _id ),
	FOREIGN KEY( msgId ) REFERENCES message( msgId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( editBy ) REFERENCES account( clientId )
		ON DELETE SET NULL
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `room_user_messages` (
	`_id`        INT UNSIGNED NOT NULL auto_increment,
	`userId`     VARCHAR( 191 ) NOT NULL,
	`roomId`     VARCHAR( 191 ) NOT NULL,
	`lastReadId` VARCHAR( 191 ),
	PRIMARY KEY( _id ),
	UNIQUE KEY( roomId, userId ),
	FOREIGN KEY( userId ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( lasReadId ) REFERENCES message( msgId )
		ON DELETE SET NULL
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_relation` (
	`_id`        INT UNSIGNED NOT NULL auto_increment,
	`relationId` VARCHAR( 191 ) NOT NULL,
	`userId`     VARCHAR( 191 ) NOT NULL,
	`contactId`  VARCHAR( 191 ) NOT NULL,
	`created`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`roomId`     VARCHAR( 191 ) NULL,
	`lastReadId` VARCHAR( 191 ) NULL,
	`lastMsgId`  VARCHAR( 191 ) NULL,
	PRIMARY KEY( _id ),
	UNIQUE KEY( userId, contactId ),
	FOREIGN KEY( userId ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( contactId ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( lastReadId ) REFERENCES message( msgId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( lastMsgId ) REFERENCES message( msgId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `invite_token` (
	`_id`           INT UNSIGNED NOT NULL auto_increment,
	`token`         VARCHAR( 191 ) NOT NULL,
	`roomId`        VARCHAR( 191 ) NOT NULL,
	`singleUse`     BOOLEAN NOT NULL,
	`isValid`       BOOLEAN NOT NULL DEFAULT 1,
	`createdBy`     VARCHAR( 191 ) NOT NULL,
	`created`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`invalidatedBy` VARCHAR( 191 ),
	`invalidated`   TIMESTAMP NULL,
	PRIMARY KEY( _id ),
	UNIQUE KEY( token ),
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( createdBy ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `invite_token_used` (
	`_id`      INT UNSIGNED NOT NULL auto_increment,
	`tokenId`  INT UNSIGNED NOT NULL,
	`usedTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`usedBy`   VARCHAR( 191 ),
	PRIMARY KEY( _id ),
	FOREIGN KEY( tokenId ) REFERENCES invite_token( _id )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `db_history` (
	`_id`     INT UNSIGNED NOT NULL auto_increment,
	`version` INT UNSIGNED NOT NULL,
	`comment` VARCHAR( 191 ) NOT NULL,
	`applied` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY( _id )
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `db_history`(
	`version`,
	`comment`
) VALUES (
	28,
	'tables.sql'
);
