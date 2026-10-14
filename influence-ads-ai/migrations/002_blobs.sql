-- Almacenamiento de archivos en la base de datos (para entornos sin disco persistente, como Vercel).
CREATE TABLE asset_blobs (
  storage_key text PRIMARY KEY,
  content     bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Al borrar un archivo se borra también su contenido.
CREATE FUNCTION assets_delete_blob() RETURNS trigger AS $$
BEGIN
  DELETE FROM asset_blobs WHERE storage_key = OLD.storage_key;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER assets_delete_blob AFTER DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION assets_delete_blob();
