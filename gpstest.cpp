#include <TinyGPS++.h>

HardwareSerial gpsSerial(1); // Serial1
#define GPS_RX 4
#define GPS_TX 2


TinyGPSPlus gps;

bool show_debug_msgs = true;

void setup() {
  Serial.begin(115200);
  delay(1000);


  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);
  if (show_debug_msgs) Serial.println("GPS Serial initialized...");

  if (show_debug_msgs) Serial.println("Waiting for GPS data...");
}

void loop() {

  while (gpsSerial.available() > 0) {
    char c = gpsSerial.read();
    gps.encode(c);
  }


  if (gps.location.isUpdated()) {
    if (show_debug_msgs) {
      Serial.print("Latitude: ");
      Serial.print(gps.location.lat(), 6);
      Serial.print("  Longitude: ");
      Serial.println(gps.location.lng(), 6);
    }
  }


  if (gps.altitude.isUpdated()) {
    if (show_debug_msgs) {
      Serial.print("Altitude: ");
      Serial.println(gps.altitude.meters());
    }
  }


  if (gps.speed.isUpdated()) {
    if (show_debug_msgs) {
      Serial.print("Speed (km/h): ");
      Serial.println(gps.speed.kmph());
    }
  }

 
  delay(500);
}
