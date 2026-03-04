'use strict';

const { createWorker } = require('tesseract.js');

let autoPlayRunning = false;
let autoPlayAbort = false;
let loginAbort = false;
const alreadyLearnedCourse = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Wait for an element to appear inside the webview
async function waitForElement(webview, selector, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await webview.executeJavaScript(`!!document.querySelector('${selector}')`);
    if (found) return true;
    await sleep(500);
  }
  throw new Error(`Timeout waiting for element: ${selector}`);
}

// Wait for element inside iframe named "zwshow"
async function waitForIframeElement(webview, selector, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await webview.executeJavaScript(`
      (function() {
        try {
          var iframe = document.querySelector('iframe[name="zwshow"]');
          if (!iframe || !iframe.contentDocument) return false;
          return !!iframe.contentDocument.querySelector('${selector}');
        } catch(e) { return false; }
      })()
    `);
    if (found) return true;
    await sleep(500);
  }
  throw new Error(`Timeout waiting for iframe element: ${selector}`);
}

// Handle captcha using tesseract.js OCR
async function handleCaptcha(webview, log) {
  const maxAttempts = 5;

  // Create OCR worker once and reuse
  let worker;
  try {
    worker = await createWorker('eng');
  } catch (e) {
    log(`Failed to create OCR worker: ${e.message}`);
    return false;
  }

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (loginAbort) {
        log('Login stopped by user');
        return false;
      }

      log(`Captcha OCR attempt ${attempt}/${maxAttempts}...`);

      try {
        await waitForElement(webview, '#yzmmsg_xh', 10000);

        // Wait for the captcha image to fully load
        await sleep(800);

        // Extract captcha image as base64
        const base64 = await webview.executeJavaScript(`
          (function() {
            var img = document.querySelector('#yzmmsg_xh');
            if (!img) return null;
            var canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
          })()
        `);

        if (!base64) {
          log('Failed to extract captcha image, refreshing...');
          await webview.executeJavaScript(`
            var img = document.querySelector('#yzmmsg_xh');
            if (img) img.click();
          `);
          await sleep(1000);
          continue;
        }

        // OCR
        const { data: { text } } = await worker.recognize(base64);
        const captchaText = text.trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 4);
        log(`OCR result: "${captchaText}"`);

        if (!captchaText || captchaText.length !== 4) {
          log('OCR result too short, refreshing captcha...');
          await webview.executeJavaScript(`
            var img = document.querySelector('#yzmmsg_xh');
            if (img) img.click();
          `);
          await sleep(1000);
          continue;
        }

        // Fill captcha and click login
        await webview.executeJavaScript(`
          var input = document.querySelector('#xhYzm');
          if (input) {
            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            ).set;
            nativeInputValueSetter.call(input, '${captchaText.replace(/'/g, "\\'")}');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        `);

        await webview.executeJavaScript(`
          var btn = document.querySelector('#login_zsxh');
          if (btn) btn.click();
        `);

        // Wait and check for login success by looking for the post-login popup
        // or the login form becoming hidden (more reliable than checking DOM removal)
        await sleep(3000);

        const loginSuccess = await webview.executeJavaScript(`
          (function() {
            // Check if success popup appeared
            var popup = document.querySelector('.popup-main-xq');
            if (popup) return true;
            // Check if the login form is no longer visible
            var loginBtn = document.querySelector('#login_zsxh');
            if (!loginBtn) return true;
            if (loginBtn.offsetParent === null) return true;
            // Check if URL changed (redirected after login)
            if (window.location.href.includes('mainIndex')) return true;
            return false;
          })()
        `);

        if (loginSuccess) {
          log('Login successful');
          return true;
        }

        log('Captcha likely incorrect, refreshing for next attempt...');
        // Clear input and refresh captcha image
        await webview.executeJavaScript(`
          var input = document.querySelector('#xhYzm');
          if (input) input.value = '';
          var img = document.querySelector('#yzmmsg_xh');
          if (img) img.click();
        `);
        await sleep(1000);

      } catch (e) {
        log(`Captcha error: ${e.message}`);
      }
    }

    // All OCR attempts failed
    log(`Auto-OCR failed after ${maxAttempts} attempts. Please login manually in the browser below.`);
    return false;
  } finally {
    await worker.terminate();
  }
}

// Login to the platform
async function loginAccount(webview, { username, password, schoolCode }, log) {
  if (!username || !password) {
    log('Username and password are required');
    return false;
  }

  loginAbort = false;

  try {
    log('Starting login process...');
    await sleep(1000);

    if (loginAbort) { log('Login stopped'); return false; }

    // Click the login button in header
    log('Clicking header login button...');
    await webview.executeJavaScript(`
      var btn = document.querySelector('.header-dengl');
      if (btn) btn.click();
    `);
    await sleep(1500);

    if (loginAbort) { log('Login stopped'); return false; }

    // Click "学号登录" tab
    log('Clicking student ID login tab...');
    await waitForElement(webview, "a", 5000);
    await webview.executeJavaScript(`
      (function() {
        var links = document.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
          if (links[i].textContent.includes('学号登录')) {
            links[i].click();
            return true;
          }
        }
        return false;
      })()
    `);
    await sleep(1000);

    if (loginAbort) { log('Login stopped'); return false; }

    // Select school
    log('Selecting school...');
    await waitForElement(webview, '#bjssxy', 10000);
    await webview.executeJavaScript(`
      (function() {
        var sel = document.querySelector('#bjssxy');
        if (sel) {
          sel.value = '${schoolCode}';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await sleep(1000);

    if (loginAbort) { log('Login stopped'); return false; }

    // Fill username and password
    log('Filling credentials...');
    await webview.executeJavaScript(`
      (function() {
        var userInput = document.querySelector('#usercode_zsxh');
        var passInput = document.querySelector('#password_zsxh');
        if (userInput) {
          var nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          ).set;
          nativeSetter.call(userInput, '${username.replace(/'/g, "\\'")}');
          userInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (passInput) {
          var nativeSetter2 = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          ).set;
          nativeSetter2.call(passInput, '${password.replace(/'/g, "\\'")}');
          passInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    await sleep(500);

    if (loginAbort) { log('Login stopped'); return false; }

    // Handle captcha
    const captchaResult = await handleCaptcha(webview, log);
    if (!captchaResult) {
      log('Captcha handling failed');
      return false;
    }

    log('Login completed successfully');
    return true;

  } catch (e) {
    log(`Login error: ${e.message}`);
    return false;
  }
}

// Close the post-login popup
async function closeLoginPopup(webview, log) {
  try {
    await waitForElement(webview, '.popup-main-xq', 10000);
    await webview.executeJavaScript(`
      var btn = document.querySelector('.popup-main-xq');
      if (btn) btn.click();
    `);
    log('Closed login popup');
    await sleep(1000);
  } catch (e) {
    log('No login popup found (or already closed)');
  }
}

// Navigate to the first course via "继续学习"
async function findCourse(webview, log) {
  try {
    await waitForElement(webview, '.styu-b-r', 10000);
    await webview.executeJavaScript(`
      (function() {
        var div = document.querySelector('.styu-b-r');
        if (div) {
          var link = div.querySelector('a');
          if (link) link.click();
        }
      })()
    `);
    log('Clicked continue learning link');
    await sleep(2000);
  } catch (e) {
    log(`Find course error: ${e.message}`);
  }
}

// Get course list from the left sidebar
async function getContent(webview) {
  return await webview.executeJavaScript(`
    (function() {
      try {
        var leftSide = document.querySelector('div.left_nav') ||
          document.evaluate('/html/body/div[12]/div[2]/div/div[1]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (!leftSide) return [];
        var dds = leftSide.querySelectorAll('dd');
        var result = [];
        for (var i = 0; i < dds.length; i++) {
          var dd = dds[i];
          var text = dd.textContent.trim().replace(/\\n/g, ' ');
          var hasA = !!dd.querySelector('#a');
          var hasR = !!dd.querySelector('#r');
          var hasF = !!dd.querySelector('#f');
          var isTest = text.includes('单元测试') || text.includes('测试');
          result.push({ index: i, text: text, hasA: hasA, hasR: hasR, hasF: hasF, isTest: isTest });
        }
        return result;
      } catch(e) { return []; }
    })()
  `);
}

// Choose the next unlearned course (skip tests and already-learned)
function chooseCourse(courseList, log) {
  const notLearned = [];
  let alreadyCount = 0;
  let skippedTests = 0;

  for (const course of courseList) {
    if (course.isTest) {
      skippedTests++;
      continue;
    }
    if (course.hasA) {
      alreadyCount++;
    } else if (course.hasR || course.hasF) {
      if (alreadyLearnedCourse.includes(course.text)) {
        alreadyCount++;
        continue;
      }
      notLearned.push(course);
    }
  }

  log(`Courses: ${notLearned.length} unlearned, ${alreadyCount} completed, ${skippedTests} tests skipped`);
  return notLearned;
}

// Play all videos in a single course section
async function playVideo(webview, course, log) {
  try {
    log(`Learning: ${course.text}`);

    // Click the course link
    await webview.executeJavaScript(`
      (function() {
        var dds = document.querySelectorAll('dd');
        var dd = dds[${course.index}];
        if (dd) {
          var link = dd.querySelector('a');
          if (link) link.click();
        }
      })()
    `);
    await sleep(2000);

    // Count videos inside the iframe
    await waitForIframeElement(webview, '[id^="sp_index_"]', 10000);

    const videoCount = await webview.executeJavaScript(`
      (function() {
        var iframe = document.querySelector('iframe[name="zwshow"]');
        if (!iframe || !iframe.contentDocument) return 0;
        var count = 0;
        var idx = 1;
        while (iframe.contentDocument.querySelector('#sp_index_' + idx)) {
          count++;
          idx++;
        }
        return count;
      })()
    `);

    log(`Section has ${videoCount} video(s)`);

    for (let vi = 1; vi <= videoCount; vi++) {
      if (autoPlayAbort) {
        log('Auto play stopped by user');
        return false;
      }

      // Check if this video is already completed
      const status = await webview.executeJavaScript(`
        (function() {
          var iframe = document.querySelector('iframe[name="zwshow"]');
          if (!iframe || !iframe.contentDocument) return '';
          var el = iframe.contentDocument.querySelector('#sp_index_${vi}');
          return el ? el.textContent.trim() : '';
        })()
      `);

      if (status === '已完成') {
        log(`Video ${vi}/${videoCount} already completed, skipping`);
        continue;
      }

      log(`Playing video ${vi}/${videoCount}...`);

      // Click the play button
      await webview.executeJavaScript(`
        (function() {
          var iframe = document.querySelector('iframe[name="zwshow"]');
          if (!iframe || !iframe.contentDocument) return;
          var doc = iframe.contentDocument;

          // Try method 1: onclick attribute
          var btn = doc.querySelector('#myVideoImg_${vi} a[onclick*="videoclick"]');
          if (btn) { btn.click(); return; }

          // Try method 2: first <a> inside myVideoImg
          var container = doc.querySelector('#myVideoImg_${vi}');
          if (container) {
            var a = container.querySelector('a');
            if (a) { a.click(); return; }
          }

          // Try method 3: call videoclick directly
          var div = doc.querySelector('div[videoid="myVideo_${vi}"]');
          if (div) {
            var spdm = div.getAttribute('spdm');
            if (spdm && typeof iframe.contentWindow.videoclick === 'function') {
              iframe.contentWindow.videoclick(null, spdm);
            }
          }
        })()
      `);
      await sleep(3000);

      // Wait for video element and get duration
      await waitForIframeElement(webview, '#myVideo_' + vi, 10000);

      const duration = await webview.executeJavaScript(`
        (function() {
          var iframe = document.querySelector('iframe[name="zwshow"]');
          if (!iframe || !iframe.contentDocument) return 0;
          var video = iframe.contentDocument.querySelector('#myVideo_${vi}');
          return video ? video.duration : 0;
        })()
      `);

      log(`Video ${vi} duration: ${Math.round(duration)}s`);

      // Poll until video finishes
      let currentTime = 0;
      while (currentTime < duration - 0.5) {
        if (autoPlayAbort) {
          log('Auto play stopped by user');
          return false;
        }

        currentTime = await webview.executeJavaScript(`
          (function() {
            var iframe = document.querySelector('iframe[name="zwshow"]');
            if (!iframe || !iframe.contentDocument) return 0;
            var video = iframe.contentDocument.querySelector('#myVideo_${vi}');
            return video ? video.currentTime : 0;
          })()
        `);

        const pct = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;
        log(`Video ${vi}/${videoCount}: ${pct}% (${Math.round(currentTime)}s / ${Math.round(duration)}s)`);
        await sleep(5000);
      }

      // Verify completion
      const finalStatus = await webview.executeJavaScript(`
        (function() {
          var iframe = document.querySelector('iframe[name="zwshow"]');
          if (!iframe || !iframe.contentDocument) return '';
          var el = iframe.contentDocument.querySelector('#sp_index_${vi}');
          return el ? el.textContent.trim() : '';
        })()
      `);
      log(`Video ${vi} status: ${finalStatus}`);
    }

    // Check if all videos in this section are done
    const allDone = await webview.executeJavaScript(`
      (function() {
        var iframe = document.querySelector('iframe[name="zwshow"]');
        if (!iframe || !iframe.contentDocument) return false;
        var idx = 1;
        while (true) {
          var el = iframe.contentDocument.querySelector('#sp_index_' + idx);
          if (!el) break;
          if (el.textContent.trim() !== '已完成') return false;
          idx++;
        }
        return true;
      })()
    `);

    if (allDone) {
      log('All videos in this section completed');
      alreadyLearnedCourse.push(course.text);
      return true;
    } else {
      log('Some videos in this section may not be completed');
      return false;
    }

  } catch (e) {
    log(`Play video error: ${e.message}`);
    return false;
  }
}

// Main auto-play loop
async function startAutoPlay(webview, log) {
  autoPlayRunning = true;
  autoPlayAbort = false;

  try {
    // Close any popup first
    await closeLoginPopup(webview, log);

    // Navigate to course
    await findCourse(webview, log);
    await sleep(2000);

    while (!autoPlayAbort) {
      const courseList = await getContent(webview);
      if (!courseList || courseList.length === 0) {
        log('No courses found on page');
        break;
      }

      const notLearned = chooseCourse(courseList, log);
      if (notLearned.length === 0) {
        log('All courses have been completed!');
        break;
      }

      const played = await playVideo(webview, notLearned[0], log);
      if (autoPlayAbort) break;

      if (played) {
        log('Refreshing page for next course...');
      } else {
        log('Retrying after failure...');
      }

      // Refresh and wait for page to reload
      await webview.executeJavaScript('window.location.reload()');
      await sleep(3000);
    }

    log(autoPlayAbort ? 'Auto play stopped' : 'Auto play finished');
  } catch (e) {
    log(`Auto play error: ${e.message}`);
  } finally {
    autoPlayRunning = false;
  }
}

function stopAutoPlay() {
  autoPlayAbort = true;
}

function stopLogin() {
  loginAbort = true;
}

function isAutoPlayRunning() {
  return autoPlayRunning;
}

module.exports = {
  loginAccount,
  closeLoginPopup,
  findCourse,
  startAutoPlay,
  stopAutoPlay,
  stopLogin,
  isAutoPlayRunning,
};
