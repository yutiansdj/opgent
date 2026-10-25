/**
 * 多语言对接模板
 *
 * 统一协议（与 shell agent 完全一致）：
 *   1. POST /api/devices/register        {deviceUid, name, token}
 *   2. POST /api/agent/heartbeat?token=  上行设备状态
 *   3. GET  /api/agent/poll?token=       长轮询取指令（最长挂 20 秒）
 *      返回纯文本：`NONE` 或 `CMD <requestId> <cmd> <base64参数...>`
 *   4. POST /api/agent/result?token=     回传结果（stdout/stderr 用 base64）
 *
 * 参数按指令固定顺序 base64 编码，缺省位是 `-`。
 * 这样客户端不需要解析任何 JSON，任意语言几十行就能接上。
 */

const HEADER_NOTE = `/*
 * 对接模板 —— 需要改的只有三处：
 *   BASE  服务器地址
 *   TOKEN 项目专属 token（后台「项目管理」里复制）
 *   NAME  设备名称
 */`;

export const INTEGRATION_SAMPLES = [
  {
    key: 'cpp',
    ext: 'cpp',
    name: 'C++（libcurl）',
    lang: 'cpp',
    desc: 'NDK 原生、静态库、桌面程序都能用',
    code: `${HEADER_NOTE}
#include <curl/curl.h>
#include <string>
#include <cstdio>
#include <thread>
#include <chrono>

static const char* BASE  = "https://43.251.226.134";
static const char* TOKEN = "dt_你的项目token";
static const char* NAME  = "我的设备";

// curl 写回调：把响应收集到 std::string
static size_t onWrite(char* p, size_t size, size_t n, void* user) {
    ((std::string*)user)->append(p, size * n);
    return size * n;
}

static std::string httpGet(const std::string& url, long timeout = 35) {
    CURL* c = curl_easy_init();
    std::string body;
    if (!c) return body;
    curl_easy_setopt(c, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, onWrite);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(c, CURLOPT_TIMEOUT, timeout);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 0L);   // 自签证书
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYHOST, 0L);
    curl_easy_perform(c);
    curl_easy_cleanup(c);
    return body;
}

static std::string httpPost(const std::string& url, const std::string& form) {
    CURL* c = curl_easy_init();
    std::string body;
    if (!c) return body;
    curl_easy_setopt(c, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c, CURLOPT_POSTFIELDS, form.c_str());
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, onWrite);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(c, CURLOPT_TIMEOUT, 20);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYHOST, 0L);
    curl_easy_perform(c);
    curl_easy_cleanup(c);
    return body;
}

// 执行一条 shell 命令，返回 (ok, stdout)
static bool runShell(const std::string& cmd, std::string& out) {
    FILE* f = popen(("/system/bin/sh -c '" + cmd + "'").c_str(), "r");
    if (!f) return false;
    char buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) out.append(buf, n);
    return pclose(f) == 0;
}

int main() {
    curl_global_init(CURL_GLOBAL_DEFAULT);

    // 1) 注册
    httpPost(std::string(BASE) + "/api/devices/register",
             "{\\"deviceUid\\":\\"my-uid\\",\\"name\\":\\"" + std::string(NAME) +
             "\\",\\"token\\":\\"" + TOKEN + "\\"}");

    for (;;) {
        // 2) 心跳
        httpPost(std::string(BASE) + "/api/agent/heartbeat?token=" + TOKEN, "battery=80&network=wifi");

        // 3) 长轮询（服务端最多挂 20 秒）
        std::string line = httpGet(std::string(BASE) + "/api/agent/poll?token=" + TOKEN);

        if (line.rfind("CMD ", 0) == 0) {
            // 格式：CMD <requestId> <cmd> <b64参数...>
            size_t p1 = line.find(' ');
            size_t p2 = line.find(' ', p1 + 1);
            std::string rid = line.substr(p1 + 1, p2 - p1 - 1);
            std::string cmd = line.substr(p2 + 1);
            cmd = cmd.substr(0, cmd.find_first_of(" \\r\\n"));

            std::string out;
            bool ok = runShell("echo placeholder", out);   // ← 这里换成真正的命令分发

            // 4) 回传结果（stdout 需要 base64）
            httpPost(std::string(BASE) + "/api/agent/result?token=" + TOKEN,
                     "requestId=" + rid + "&ok=" + (ok ? "1" : "0") +
                     "&exitCode=0&durationMs=0&stdout=" + out);
        } else {
            std::this_thread::sleep_for(std::chrono::seconds(2));
        }
    }
}
`
  },
  {
    key: 'java',
    ext: 'java',
    name: 'Java（Android / 桌面）',
    lang: 'java',
    desc: '纯 JDK，不依赖任何第三方库',
    code: `${HEADER_NOTE}
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class Agent {
    static final String BASE  = "https://43.251.226.134";
    static final String TOKEN = "dt_你的项目token";
    static final String NAME  = "我的设备";

    static String get(String url, int timeoutSec) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(timeoutSec * 1000);
        try (InputStream in = c.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static String post(String url, String body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        c.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        try (InputStream in = c.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    // 执行 shell 命令，捕获 stdout
    static String sh(String cmd) {
        try {
            Process p = new ProcessBuilder("/system/bin/sh", "-c", cmd)
                    .redirectErrorStream(true).start();
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            p.waitFor();
            return out;
        } catch (Exception e) {
            return "ERR: " + e.getMessage();
        }
    }

    public static void main(String[] args) throws Exception {
        post(BASE + "/api/devices/register",
             "{\\"deviceUid\\":\\"my-uid\\",\\"name\\":\\"" + NAME + "\\",\\"token\\":\\"" + TOKEN + "\\"}");

        while (true) {
            try {
                post(BASE + "/api/agent/heartbeat?token=" + TOKEN, "battery=80&network=wifi");

                String line = get(BASE + "/api/agent/poll?token=" + TOKEN, 35);

                if (line.startsWith("CMD ")) {
                    String[] f = line.trim().split(" ");
                    String rid = f[1];
                    String cmd = f[2];

                    String out = sh("echo placeholder");   // ← 换成真实命令分发
                    String b64 = Base64.getEncoder().encodeToString(out.getBytes(StandardCharsets.UTF_8));

                    post(BASE + "/api/agent/result?token=" + TOKEN,
                         "requestId=" + rid + "&ok=1&exitCode=0&durationMs=0&stdout=" +
                         URLEncoder.encode(b64, "UTF-8"));
                } else {
                    Thread.sleep(2000);
                }
            } catch (Exception e) {
                Thread.sleep(5000);   // 网络异常退避
            }
        }
    }
}
`
  },
  {
    key: 'kotlin',
    ext: 'kt',
    name: 'Kotlin（Android）',
    lang: 'kotlin',
    desc: '协程 + HttpURLConnection，放进 Service 即可',
    code: `${HEADER_NOTE}
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64

private const val BASE  = "https://43.251.226.134"
private const val TOKEN = "dt_你的项目token"
private const val NAME  = "我的设备"

fun http(url: String, method: String = "GET", body: String? = null, timeoutMs: Int = 35000): String {
    val c = URL(url).openConnection() as HttpURLConnection
    c.requestMethod = method
    c.connectTimeout = 10_000
    c.readTimeout = timeoutMs
    if (body != null) {
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        c.outputStream.use { it.write(body.toByteArray()) }
    }
    return c.inputStream.bufferedReader().use(BufferedReader::readText)
}

fun shell(cmd: String): String = try {
    val p = ProcessBuilder("/system/bin/sh", "-c", cmd).redirectErrorStream(true).start()
    val out = p.inputStream.bufferedReader().readText()
    p.waitFor()
    out
} catch (e: Exception) {
    "ERR: \${e.message}"
}

fun main() = runBlocking {
    http("$BASE/api/devices/register", "POST",
         """{"deviceUid":"my-uid","name":"$NAME","token":"$TOKEN"}""")

    while (isActive) {
        try {
            http("$BASE/api/agent/heartbeat?token=$TOKEN", "POST", "battery=80&network=wifi")

            val line = http("$BASE/api/agent/poll?token=$TOKEN").trim()

            if (line.startsWith("CMD ")) {
                val parts = line.split(" ")
                val rid = parts[1]
                val cmd = parts[2]

                val out = shell("echo placeholder")          // ← 换成真实分发
                val b64 = Base64.getEncoder().encodeToString(out.toByteArray())

                http("$BASE/api/agent/result?token=$TOKEN", "POST",
                     "requestId=$rid&ok=1&exitCode=0&durationMs=0&stdout=$b64")
            } else {
                delay(2000)
            }
        } catch (e: Exception) {
            delay(5000)
        }
    }
}
`
  },
  {
    key: 'python',
    ext: 'py',
    name: 'Python 3',
    lang: 'python',
    desc: 'requests 长轮询，适合 PC / 树莓派侧接入',
    code: `# -*- coding: utf-8 -*-
${HEADER_NOTE.replace('/*', '#').replace('*/', '#')}
import base64
import subprocess
import time

import requests

BASE  = "https://43.251.226.134"
TOKEN = "dt_你的项目token"
NAME  = "我的设备"

requests.packages.urllib3.disable_warnings()   # 自签证书


def get(url, timeout=35):
    return requests.get(url, timeout=timeout, verify=False).text


def post(url, data):
    return requests.post(url, data=data, timeout=20, verify=False).text


def shell(cmd):
    p = subprocess.run(["/system/bin/sh", "-c", cmd],
                       capture_output=True, text=True)
    return p.stdout


def main():
    post(f"{BASE}/api/devices/register",
         {"deviceUid": "my-uid", "name": NAME, "token": TOKEN})

    while True:
        try:
            post(f"{BASE}/api/agent/heartbeat?token={TOKEN}",
                 {"battery": 80, "network": "wifi"})

            line = get(f"{BASE}/api/agent/poll?token={TOKEN}").strip()

            if line.startswith("CMD "):
                _, rid, cmd, *_ = line.split(" ")
                out = shell("echo placeholder")          # ← 换成真实分发
                b64 = base64.b64encode(out.encode()).decode()

                post(f"{BASE}/api/agent/result?token={TOKEN}",
                     {"requestId": rid, "ok": 1, "exitCode": 0,
                      "durationMs": 0, "stdout": b64})
            else:
                time.sleep(2)
        except Exception as e:
            print("retry:", e)
            time.sleep(5)


if __name__ == "__main__":
    main()
`
  },
  {
    key: 'go',
    ext: 'go',
    name: 'Go',
    lang: 'go',
    desc: '单文件、可交叉编译成 arm64 静态二进制',
    code: `package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"time"
	"crypto/tls"
)

const (
	base  = "https://43.251.226.134"
	token = "dt_你的项目token"
	name  = "我的设备"
)

var client = &http.Client{
	Timeout: 40 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // 自签证书
	},
}

func get(u string) string {
	resp, err := client.Get(u)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func post(u string, form url.Values) string {
	resp, err := client.PostForm(u, form)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func shell(cmd string) string {
	out, _ := exec.Command("/system/bin/sh", "-c", cmd).CombinedOutput()
	return string(out)
}

func main() {
	post(base+"/api/devices/register", url.Values{
		"deviceUid": {"my-uid"}, "name": {name}, "token": {token},
	})

	for {
		post(base+"/api/agent/heartbeat?token="+token, url.Values{
			"battery": {"80"}, "network": {"wifi"},
		})

		line := strings.TrimSpace(get(base + "/api/agent/poll?token=" + token))

		if strings.HasPrefix(line, "CMD ") {
			f := strings.SplitN(line, " ", 4)
			rid, cmd := f[1], f[2]

			out := shell("echo placeholder") // ← 换成真实分发
			b64 := base64.StdEncoding.EncodeToString([]byte(out))

			post(base+"/api/agent/result?token="+token, url.Values{
				"requestId": {rid}, "ok": {"1"}, "exitCode": {"0"},
				"durationMs": {"0"}, "stdout": {b64},
			})
		} else {
			time.Sleep(2 * time.Second)
		}
	}
}

var _ = fmt.Sprintf
`
  },
  {
    key: 'node',
    ext: 'js',
    name: 'Node.js',
    lang: 'javascript',
    desc: 'fetch 长轮询，适合在服务器侧跑',
    code: `// Node 18+ 自带 fetch
const BASE  = 'https://43.251.226.134'
const TOKEN = 'dt_你的项目token'
const NAME  = '我的设备'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // 自签证书（生产建议配正式证书）

const { exec } = require('node:child_process')

const get = (u) => fetch(u).then((r) => r.text())
const post = (u, body) =>
  fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }).then((r) => r.text())

const shell = (cmd) =>
  new Promise((res) => exec(cmd, { shell: '/system/bin/sh' }, (e, out) => res(out || '')))

async function main() {
  await post(
    \`\${BASE}/api/devices/register\`,
    new URLSearchParams({ deviceUid: 'my-uid', name: NAME, token: TOKEN })
  )

  for (;;) {
    try {
      await post(
        \`\${BASE}/api/agent/heartbeat?token=\${TOKEN}\`,
        new URLSearchParams({ battery: '80', network: 'wifi' })
      )

      const line = (await get(\`\${BASE}/api/agent/poll?token=\${TOKEN}\`)).trim()

      if (line.startsWith('CMD ')) {
        const [, rid, cmd] = line.split(' ')

        const out = await shell('echo placeholder') // ← 换成真实分发
        const b64 = Buffer.from(out).toString('base64')

        await post(
          \`\${BASE}/api/agent/result?token=\${TOKEN}\`,
          new URLSearchParams({ requestId: rid, ok: '1', exitCode: '0', durationMs: '0', stdout: b64 })
        )
      } else {
        await new Promise((r) => setTimeout(r, 2000))
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

main()
`
  },
  {
    key: 'csharp',
    ext: 'cs',
    name: 'C#（.NET）',
    lang: 'csharp',
    desc: 'HttpClient 版本，可跑在 Windows / Linux',
    code: `${HEADER_NOTE}
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

class Agent
{
    const string BASE  = "https://43.251.226.134";
    const string TOKEN = "dt_你的项目token";
    const string NAME  = "我的设备";

    static readonly HttpClient http = new HttpClient(
        new HttpClientHandler { ServerCertificateCustomValidationCallback = (_, __, ___, ____) => true })
    { Timeout = TimeSpan.FromSeconds(40) };

    static async Task<string> Post(string url, string form) =>
        await http.PostAsync(url, new StringContent(form, Encoding.UTF8, "application/x-www-form-urlencoded"))
                  .ContinueWith(t => t.Result.Content.ReadAsStringAsync()).Unwrap();

    static async Task Main()
    {
        await Post(BASE + "/api/devices/register",
            "{\\"deviceUid\\":\\"my-uid\\",\\"name\\":\\"" + NAME + "\\",\\"token\\":\\"" + TOKEN + "\\"}");

        while (true)
        {
            try
            {
                await Post(BASE + "/api/agent/heartbeat?token=" + TOKEN, "battery=80&network=wifi");

                var line = (await http.GetStringAsync(BASE + "/api/agent/poll?token=" + TOKEN)).Trim();

                if (line.StartsWith("CMD "))
                {
                    var f = line.Split(' ');
                    var rid = f[1];
                    var cmd = f[2];

                    var output = "placeholder";   // ← 换成真实命令执行
                    var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(output));

                    await Post(BASE + "/api/agent/result?token=" + TOKEN,
                        "requestId=" + rid + "&ok=1&exitCode=0&durationMs=0&stdout="
                        + Uri.EscapeDataString(b64));
                }
                else
                {
                    await Task.Delay(2000);
                }
            }
            catch
            {
                await Task.Delay(5000);
            }
        }
    }
}
`
  }
];

export function getSample(key) {
  return INTEGRATION_SAMPLES.find((s) => s.key === key) || INTEGRATION_SAMPLES[0];
}
