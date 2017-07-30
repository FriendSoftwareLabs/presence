
DROP TABLE IF EXISTS `message`;
DROP TABLE IF EXISTS `authorized_for_room`;
DROP TABLE IF EXISTS `account`;
DROP TABLE IF EXISTS `room`;
DROP TABLE IF EXISTS `db_history`;

CREATE TABLE `account` (
	`_id`        INT UNSIGNED NOT NULL auto_increment,
	`clientId`   VARCHAR( 191 ) NOT NULL UNIQUE,
	`login`      VARCHAR( 191 ) NOT NULL UNIQUE,
	`pass`       TEXT,
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

CREATE TABLE `message` (
	`_id`       INT UNSIGNED NOT NULL auto_increment,
	`msgId`     VARCHAR( 191 ) NOT NULL UNIQUE,
	`roomId`    VARCHAR( 191 ) NOT NULL,
	`accountId` VARCHAR( 191 ),
	`timestamp` BIGINT NOT NULL,
	`type`      VARCHAR( 20 ) NOT NULL,
	`name`      VARCHAR( 191 ),
	`message`   TEXT NOT NULL,
	PRIMARY KEY( _id ),
	FOREIGN KEY( roomId ) REFERENCES room( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE,
	FOREIGN KEY( accountId ) REFERENCES account( clientId )
		ON DELETE CASCADE
		ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `db_history` (
	`_id` INT UNSIGNED NOT NULL auto_increment,
	`version` INT UNSIGNED NOT NULL,
	`comment` VARCHAR( 191 ) NOT NULL,
	`applied` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY( _id )
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `db_history`(
	`version`,
	`comment`
) VALUES (
	9,
	'tables.sql'
);
