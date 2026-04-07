-- Update all videos to Flux 2 Pro image model
UPDATE studio.videos SET image_model = 'flux-2/pro-text-to-image' WHERE image_model != 'flux-2/pro-text-to-image';
