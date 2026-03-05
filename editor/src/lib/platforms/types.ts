export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  error?: string;
}

export interface MediaUploadResult {
  success: boolean;
  mediaId?: string;
  error?: string;
}
