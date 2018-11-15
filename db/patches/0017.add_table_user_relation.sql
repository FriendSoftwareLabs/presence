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