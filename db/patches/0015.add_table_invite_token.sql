CREATE TABLE `invite_token` (
    `_id`           INT UNSIGNED NOT NULL auto_increment,
    `token`         VARCHAR( 191 ) NOT NULL,
    `roomId`        VARCHAR( 191 ) NOT NULL,
    `singleUse`     BOOLEAN NOT NULL,
    `isValid`       BOOLEAN NOT NULL DEFAULT 1,
    `createdBy`     VARCHAR( 191 ) NOT NULL,
    `created`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `invalidatedBy` VARCHAR( 191 ),
    `invalidated`   TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY( _id ),
    UNIQUE KEY( token ),
    FOREIGN KEY( roomId ) REFERENCES room( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY( createdBy ) REFERENCES account( clientId )
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=INNODB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;