const puppeteer = require('puppeteer');
const http = require('http');
const url = require('url');
const fs = require('fs');
const querystring = require('querystring');
const savePath = '/screenshots';
const port = 8668;
const crypto = require('crypto');
const util = require('util');
const path = require('path');

let browser = null;

function md5(input) {
	return crypto
		.createHash('md5')
		.update(input)
		.digest('hex');
}

function send500(res) {
	res.writeHead(500, {
		'content-type': 'text/plain; charset=utf-8'
	});
	res.end('');
}

function mkdirs(file = '') {
	file.split(path.sep)
		.reduce((prevPath, folder) => {
			const currentPath = path.join(prevPath, folder, path.sep);
			if (!fs.existsSync(currentPath)) {
				fs.mkdirSync(currentPath);
			}
			return currentPath;
		}, '');
}

async function cut2imgs(page, url, folders) {
	mkdirs(folders); // 保证文件夹存在

	let viewPort = {
		width: 750,
		height: 3000,
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true
	};

	async function screenShot() {
		let top = 0;
		let totalHeight = await page.evaluate(() => {
			return document.documentElement.scrollHeight;
		});
		let filename = 0; // 文件名自增
		let height = Math.floor(viewPort.height / 2);
		await page.setViewport(Object.assign({}, viewPort, {
			height: totalHeight | 0
		}));
		while (top < totalHeight) {
			// console.log(top);
			// await page.evaluate(async (top) => {
			// 	window.scrollTo(0, top);
			// 	await new Promise(resolve => {
			// 		setTimeout(resolve, 3000);
			// 	});
			// }, top);
			await new Promise(resolve => {
				setTimeout(resolve, 300);
			});
			await page.screenshot({
				path: path.resolve(folders, `${filename++}.jpg`),
				type: 'jpeg',
				omitBackground: true,
				clip: {
					x: 0,
					y: top,
					width: viewPort.width,
					height: Math.min(height, totalHeight - top)
				}
			});
			top += height;
		}
	}

	let res;
	let err;
	let done = new Promise((resolve, reject) => {
		res = resolve;
		err = reject;
	});

	let tid = null;
	
	await page.setViewport(viewPort);

	let count = 0;
	let cutting = false;

	page.on('request', async function() {
		count++;
		if (tid) {
			clearTimeout(tid);
			tid = null;
		}
	});

	page.on('response', async function() {
		count--;

		if (!cutting && !count) {
			if (tid) {
				clearTimeout(tid);
				tid = null;
			}
			tid = setTimeout(async () => {
				if (cutting) {
					return;
				}
				cutting = true;
				try {
					await screenShot();
					res();
				} catch (error) {
					err(error);
				}
				
			}, 1000);
		}
	})

	page.on('requestfinished', async (request) => {
		await page.evaluate(() => {
			window.scrollTo(0, 1000000); // 用于触发瀑布流加载
		});
	});

	// 设置为android手机模式
	await page.setUserAgent('Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3626.109 Mobile Safari/537.36');

	// 等待页面加载完毕
	await page.goto(url, {
		waitUntil: 'load'
	});

	await done;
}

(async () => {
	try {
		browser = await puppeteer.launch({
			headless: true,
			// executablePath: '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome',
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});

		const server = http.createServer(async (req, res) => {

			try {
				let params = url.parse(req.url);
				let webpath = params.path;
				if (req.method === 'POST') {
					if (webpath === '/cut2imgs') {
						let body = ''; // 接受post参数
						req.on('data', (chunk) => {
							body += chunk;
						})
						req.on('end', async () => {
							try {
								body = decodeURIComponent(body);
								let post = querystring.parse(body);
								let { url, folders = '' } = post;

								url = decodeURIComponent(url);
								folders = decodeURIComponent(folders);
								folders = path.resolve(savePath, folders);

								if (url) {
									let page = await browser.newPage();
									try {
										await cut2imgs(page, url, folders);
										res.end(md5(folders));
									} catch (err) {
										console.log(err);
									}
									await page.close();
									res.end('');
								}
								send500(res);
							} catch (err) {
								console.error(err);
								send500(res);
							}
						});
						return;
					}
				}
				send500(res);
			} catch (err) {
				console.error(err);
				send500(res);
			}
		});

		server.on('clientError', (err, socket) => {
			socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
		});
		server.listen(port);

		console.info(`MTC waiting for your coming on ${port}`);
	} catch (err) {
		console.error(err);
	}
})();