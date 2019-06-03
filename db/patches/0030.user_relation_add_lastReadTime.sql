ALTER TABLE `user_relation`
ADD COLUMN `lastReadTime` BIGINT NULL
AFTER `lastReadId`;