

CREATE TABLE "Country" (
  "code" text NOT NULL,
  "name" text NOT NULL,
  PRIMARY KEY ("code")
);


CREATE TABLE Customer (
    id INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
);


CREATE TABLE "Order" (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	customerId INTEGER,
	dateTime TEXT NOT NULL,
	FOREIGN KEY(customerId) REFERENCES Customer(id)
);


CREATE TABLE "OrderItem" (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	orderId INTEGER,
	productId INTEGER,
	FOREIGN KEY(orderId) REFERENCES "Order"(id),
  FOREIGN KEY(productId) REFERENCES Product(id)
);


CREATE TABLE "Product" (
  "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
  "title_tr" text NOT NULL,
  "title_en" text NOT NULL,
  "__type" text NOT NULL,
  "categoryId" integer NULL,
  "attributes" text NULL,
  FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);


CREATE TABLE "ProductCategory" (
  "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
  "title" text NOT NULL
);


CREATE TABLE "Address" (
  "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
  "customerId" integer NOT NULL,
  "address" text NOT NULL,
  FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);



--
