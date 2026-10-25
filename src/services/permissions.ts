import { Capacitor } from '@capacitor/core';

export const requestCallPermissions = async (isVideoCall: boolean = true): Promise<boolean> => {
  // If we are on the web, the browser will handle it automatically
  if (!Capacitor.isNativePlatform()) return true;

  try {
    // 1. Ask for microphone, and camera (if it's a video call)
    const constraints = {
      audio: true,
      video: isVideoCall ? { facingMode: 'user' } : false,
    };

    // This line triggers the native Android permission popups
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // 🔥 IMPORTANT: Stop the stream immediately so we don't hog the camera/mic
    stream.getTracks().forEach((track) => track.stop());
    
    return true;
  } catch (error) {
    console.error('Permission denied or device not found:', error);
    return false;
  }
};