-- ---------------------------------------------------------------------
-- Avatar-Aufloesung 256 -> 512 px (AvatarCropModal.jsx): die Klick-Vorschau
-- zeigt das Bild bildschirmfuellend, bei 256 px sichtbar hochskaliert und
-- verpixelt. Das bestehende 256-KB-Bucket-Limit war explizit auf die alte
-- Aufloesung zugeschnitten ("ein 256px-WebP liegt weit darunter") und würde
-- ein detailreiches 512px-Foto in seltenen Faellen abweisen.
--
-- 1 MB statt grosszuegiger: WebP bei Qualitaet 0.85 liegt fuer ein 512x512-
-- Portraitfoto ueblicherweise bei 30-100 KB, das Vierfache der alten
-- Pixelzahl rechtfertigt keine Verzehnfachung des Limits.
-- ---------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 1048576
 where id = 'avatars';
