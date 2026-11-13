#define TINY_GSM_MODEM_SIM800
#define TINY_GSM_RX_BUFFER 1024
#include <TinyGsmClient.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <queue>
#include <time.h>

std::queue<String> mqttpayloads;

const char apn[] = "internet";
const char user[] = "";
const char pass[] = "";
const char* ssid = "hott";
const char* password = "hotthott";
const char* broker = "broker.hivemq.com";
const int port = 1883;
const char* topic = "watchbird/device/location";

#define SerialMon Serial
#define SerialAT Serial2
#define RXD2 16
#define TXD2 17

TinyGsm modem(SerialAT);
TinyGsmClient gsmClient(modem);
WiFiClient espClient;
PubSubClient mqttGSM(gsmClient);
PubSubClient mqttWiFi(espClient);
PubSubClient* mqtt = nullptr;

bool show_debug_msgs = 1;
uint32_t last_blink = 0, last_publish = 0, last_retry = 0;
bool led_status = 0;
int Device_id = 4, Latitude = 0, Longitude = 0, Altitude = 0, mode = 0;

void mqttCallback(char* topic, byte* payload, unsigned int length) {
}

void setup() {
  Serial.begin(115200);
  delay(3000);

  pinMode(2, OUTPUT);
  digitalWrite(2, LOW);

  if (mode == 0) {
    Serial.print("Connecting to Wi-Fi...");
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
    }
    if (show_debug_msgs) { Serial.println(" connected!"); }
    mqtt = &mqttWiFi;
  } else if (mode == 1) {
    SerialAT.begin(9600, SERIAL_8N1, RXD2, TXD2);
    delay(3000);

    if (show_debug_msgs) {
      Serial.println("Initializing modem...");
    }
    modem.restart();
    if (show_debug_msgs) {
      Serial.print("Modem Info: ");
      Serial.println(modem.getModemInfo());
    }
    if (show_debug_msgs) {
      Serial.print("Waiting for network...");
    }
    if (!modem.waitForNetwork()) {
      if (show_debug_msgs) {
        Serial.println(" FAIL");
      }
      while (true);
    }
    if (show_debug_msgs) {
      Serial.println(" OK");
      Serial.print("Connecting to GPRS...");
    }
    if (!modem.gprsConnect(apn, user, pass)) {
      if (show_debug_msgs) {
        Serial.println(" FAIL");
      }
      while (true);
    }
    if (show_debug_msgs) {
      Serial.println(" OK");
    }
    mqtt = &mqttGSM;
  }

  mqtt->setServer(broker, port);
  mqtt->setCallback(mqttCallback);
  mqtt->setKeepAlive(60);
  mqtt->setSocketTimeout(15);

  configTime(3 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("Waiting for NTP time...");
  while (time(nullptr) < 1600000000) {
    delay(500);
  }
  
  if (show_debug_msgs) { Serial.println("Setup complete"); }
}

void loop() {
  if (mqtt->connected()) {
    mqtt->loop();
  }

  if (!mqtt->connected() && (millis() - last_retry) >= 5000) {
    last_retry = millis();
    if (show_debug_msgs) { Serial.print("Connecting to MQTT..."); }
    
    char clientId[30];
    sprintf(clientId, "ESP32Client-%d", Device_id);
    
    if (mqtt->connect(clientId)) {
      if (show_debug_msgs) { Serial.println(" connected!"); }
    } else {
      if (show_debug_msgs) {
        Serial.print(" failed, rc=");
        Serial.print(mqtt->state());
        Serial.println(" trying again in 5s");
      }
    }
  }

  if (millis() - last_blink >= 1000) {
    last_blink = millis();
    led_status = !led_status;
    digitalWrite(2, led_status);
  }

  if (millis() - last_publish >= 15000) {
    last_publish = millis();
    time_t now = time(nullptr);
    char time_buf[30];
    struct tm* tm_info = localtime(&now);
    strftime(time_buf, sizeof(time_buf), "%Y-%m-%dT%H:%M:%S+03:00", tm_info);

    StaticJsonDocument<200> doc;
    doc["Timestamp"] = time_buf;
    doc["Device_id"] = Device_id;
    doc["Latitude"] = Latitude;
    doc["Longitude"] = Longitude;
    doc["Altitude"] = Altitude;

    char buffer[256];
    serializeJson(doc, buffer);
    mqttpayloads.push(String(buffer));
  }

  while (mqtt->connected() && !mqttpayloads.empty()) {
    String payload = mqttpayloads.front();
    if (mqtt->publish(topic, payload.c_str())) {
      if (show_debug_msgs) {
        Serial.print("Payload sent: ");
        Serial.println(payload);
      }
      mqttpayloads.pop();
    } else {
      if (show_debug_msgs) {
        Serial.println("Publish failed, will retry");
      }
      break;
    }
    delay(100);
  }
}