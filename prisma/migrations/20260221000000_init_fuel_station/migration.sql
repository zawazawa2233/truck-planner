-- CreateTable
CREATE TABLE IF NOT EXISTS "FuelStation" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT,
  "brand" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "isHighway" BOOLEAN NOT NULL DEFAULT false,
  "service24h" BOOLEAN NOT NULL DEFAULT false,
  "shower" BOOLEAN NOT NULL DEFAULT false,
  "convenience" BOOLEAN NOT NULL DEFAULT false,
  "largeParking" BOOLEAN NOT NULL DEFAULT false,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FuelStation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FuelStation_sourceId_key" ON "FuelStation"("sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FuelStation_brand_idx" ON "FuelStation"("brand");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FuelStation_isHighway_idx" ON "FuelStation"("isHighway");
