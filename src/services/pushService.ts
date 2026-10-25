import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export const initPushNotifications = async () => {
  if (!Capacitor.isNativePlatform()) return;

  try {
    // 1. Request Permissions
    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }
    if (permStatus.receive !== 'granted') {
      console.log('User denied push permissions');
      return;
    }

    // 2. Register with Firebase
    await PushNotifications.register();

    // 3. Listen for the Token
    PushNotifications.addListener('registration', async (token) => {
      console.log('🔥 FCM TOKEN:', token.value);
      
      try {
        const { value: accessToken } = await Preferences.get({ key: 'accessToken' });
        
        if (accessToken) {
          const res = await fetch('https://orbital.runasp.net/api/auth/save-fcm-token', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}` 
            },
            body: JSON.stringify({ token: token.value })
          });
          
          if (res.ok) {
            console.log('✅ Token saved to backend!');
          } else {
            console.error('❌ Backend rejected token', await res.text());
          }
        }
      } catch (err) {
        console.error('❌ Failed to save token', err);
      }
    });

    // 4. Handle errors safely
    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ Firebase Registration Error:', error.error);
    });

    // 5. Handle Notification Taps (Routing)
    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      const data = notification?.notification?.data;
      console.log('Notification tapped:', data);
      
      if (!data || !data.type) return;

      // 🔥 Route based on the type sent from the C# backend
      if (data.type === 'friend_request' || data.type === 'friend_accept') {
        window.location.href = '/app/friends'; 
      } 
      else if (data.type === 'message' && data.chatId) {
        // For DMs, the backend sends the sender's ID as chatId
        window.location.href = `/app/dm/${data.chatId}`;
      }
      else if (data.type === 'group_message' && data.chatId) {
        // For Groups, the backend sends the Group ID as chatId
        window.location.href = `/app/groups/${data.chatId}`;
      }
    });
    
  } catch (error) {
    console.error('❌ Push Notifications failed to initialize:', error);
  }
};