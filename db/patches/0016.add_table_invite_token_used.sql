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