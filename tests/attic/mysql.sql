
SET NAMES utf8;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;
SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO';

DROP TABLE IF EXISTS `Customer`;
CREATE TABLE `Customer` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` text COLLATE utf8_turkish_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_turkish_ci;


DROP TABLE IF EXISTS `Order`;
CREATE TABLE `Order` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dateTime` datetime NOT NULL,
  `customerId` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `customerId` (`customerId`),
  CONSTRAINT `Order_ibfk_3` FOREIGN KEY (`customerId`) REFERENCES `Customer` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_turkish_ci;


DROP TABLE IF EXISTS `OrderItem`;
CREATE TABLE `OrderItem` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `orderId` int(11) NOT NULL,
  `productId` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `orderId` (`orderId`),
  KEY `productId` (`productId`),
  CONSTRAINT `OrderItem_ibfk_1` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `OrderItem_ibfk_2` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_turkish_ci;


DROP TABLE IF EXISTS `Product`;
CREATE TABLE `Product` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title_en` varchar(120) COLLATE utf8_turkish_ci NOT NULL,
  `title_tr` varchar(120) COLLATE utf8_turkish_ci NOT NULL,
  `__type` varchar(30) COLLATE utf8_turkish_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `__type` (`__type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_turkish_ci;
