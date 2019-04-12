CREATE TABLE `room_user_messages` (
    `_id`         INT UNSIGNED NOT NULL auto_increment,
    `userId`      VARCHAR( 191 ) NOT NULL,
    `roomId`      VARCHAR( 191 ) NOT NULL,
    `createdTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `lastReadId`  VARCHAR( 191 ),
    PRIMARY KEY( _id ),
    UNIQUE KEY( roomId, userId ),
    FOREIGN KEY( userId ) REFERENCES account( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( roomId ) REFERENCES room( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( lastReadId ) REFERENCES message( msgId )
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
