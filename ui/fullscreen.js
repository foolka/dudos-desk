Object.assign(messages.ru, {
	addMedia: 'Добавить пугалку', fullscreenTitle: 'Полноэкранный элемент Dudos Lite',
	fullscreenDetail: 'Видео или картинка поверх выбранного монитора и в источнике OBS. Участвует в обычной рулетке Dudos Lite; отдельная награда Twitch не нужна.',
	mediaTitle: 'Название элемента', removeMedia: 'Удалить элемент', invalidMedia: 'Не удалось прочитать медиа. Поддерживаются MP4, WebM, PNG, JPG, WebP, GIF и аудио до 512 МБ.',
	tooManyMedia: 'Допускается до 500 собственных элементов.', mediaDefaultSound: 'Дорожка видео / тишина у картинки', mediaSoundHelp: 'Пусто: играет звук видео. Отдельный файл заменяет его и останавливается вместе с изображением.',
	mediaSoundVolume: 'Громкость отдельного звука', imageSeconds: 'Показ картинки, сек.', fit: 'Заполнение', cover: 'Заполнить с обрезкой', contain: 'Целиком без обрезки',
	enter: 'Появление', exit: 'Исчезновение', enterMs: 'Появление, мс', exitMs: 'Исчезновение, мс', enterFrom: 'Откуда появляется', exitTo: 'Куда исчезает',
	none: 'Без анимации', fade: 'Проявление', slide: 'Выезд', zoom: 'Масштаб', pop: 'Прыжок', center: 'Центр', left: 'Слева', right: 'Справа', top: 'Сверху', bottom: 'Снизу',
	mediaLocalPreview: 'Предпросмотр без звука'
});
Object.assign(messages.uk, {
	addMedia: 'Додати лякалку', fullscreenTitle: 'Повноекранний елемент Dudos Lite',
	fullscreenDetail: 'Відео або картинка поверх вибраного монітора та у джерелі OBS. Бере участь у звичайній рулетці Dudos Lite; окрема нагорода Twitch не потрібна.',
	mediaTitle: 'Назва елемента', removeMedia: 'Видалити елемент', invalidMedia: 'Не вдалося прочитати медіа. Підтримуються MP4, WebM, PNG, JPG, WebP, GIF та аудіо до 512 МБ.',
	tooManyMedia: 'Дозволено до 500 власних елементів.', mediaDefaultSound: 'Доріжка відео / тиша для картинки', mediaSoundHelp: 'Порожньо: звучить відео. Окремий файл замінює звук та зупиняється разом із зображенням.',
	mediaSoundVolume: 'Гучність окремого звуку', imageSeconds: 'Показ картинки, с', fit: 'Заповнення', cover: 'Заповнити з обрізкою', contain: 'Повністю без обрізки',
	enter: 'Поява', exit: 'Зникнення', enterMs: 'Поява, мс', exitMs: 'Зникнення, мс', enterFrom: 'Звідки з’являється', exitTo: 'Куди зникає',
	none: 'Без анімації', fade: 'Проявлення', slide: 'Виїзд', zoom: 'Масштаб', pop: 'Стрибок', center: 'Центр', left: 'Зліва', right: 'Справа', top: 'Зверху', bottom: 'Знизу',
	mediaLocalPreview: 'Перегляд без звуку'
});
Object.assign(messages.en, {
	addMedia: 'Add scare', fullscreenTitle: 'Dudos Lite fullscreen item',
	fullscreenDetail: 'Video or image on the selected monitor and in OBS. Included in the normal Dudos Lite roulette; no separate Twitch reward is needed.',
	mediaTitle: 'Item name', removeMedia: 'Delete item', invalidMedia: 'Cannot read media. Supported: MP4, WebM, PNG, JPG, WebP, GIF and audio up to 512 MB.',
	tooManyMedia: 'Up to 500 custom items are allowed.', mediaDefaultSound: 'Video audio / silent image', mediaSoundHelp: 'Empty: use the video audio. A separate file replaces it and stops together with the visual.',
	mediaSoundVolume: 'Separate audio volume', imageSeconds: 'Image duration, sec.', fit: 'Fit', cover: 'Fill and crop', contain: 'Fit without cropping',
	enter: 'Entrance', exit: 'Exit', enterMs: 'Entrance, ms', exitMs: 'Exit, ms', enterFrom: 'Enter from', exitTo: 'Exit toward',
	none: 'No animation', fade: 'Fade', slide: 'Slide', zoom: 'Zoom', pop: 'Pop', center: 'Center', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom',
	mediaLocalPreview: 'Silent preview'
});

// Individual media settings use the existing draft/save workflow.
function renderFullscreen(e) {
	const p = e.presentation;
	const select = (key, values) => `
		<label class="b-field">
			<span>${esc(t(key))}</span>
			<select data-presentation="${key}">${options(values, p[key])}</select>
		</label>`;
	const number = (key, min, max, step = 1) => `
		<label class="b-field">
			<span>${esc(t(key))}</span>
			<input type="number" data-presentation="${key}" min="${min}" max="${max}" step="${step}" value="${p[key]}" required>
		</label>`;
	$('#main').innerHTML = `
		<div class="b-editor__heading">
			<div><h1>${esc(t('fullscreenTitle'))}</h1><div class="b-muted">${esc(t('fullscreenDetail'))}</div></div>
			${iconButton('removeMedia', 'removeMedia', 'trash-2')}
		</div>
		<form id="effect-form" class="b-media-editor">
			<div class="b-form">
				${field('title', 'mediaTitle', e.title, 'type="text" maxlength="120" required')}
				<div class="b-form__row">
					<label class="b-check"><input type="checkbox" data-field="enabled" ${e.enabled ? 'checked' : ''}>${esc(t('enabled'))}${help('enabledHelp')}</label>
					${field('weight', 'weight', e.weight, 'type="number" min="0" max="10000" step="1" required', 'weightHelp')}
				</div>
				<div class="b-editor__chance"><span>${esc(t('chance'))}</span><strong id="chance"></strong></div>
				<div class="b-form__row">
					${select('fit', ['cover', 'contain'])}
					${e.mediaKind === 'image' ? number('imageSeconds', .1, 600, .1) : ''}
				</div>
				<label class="b-field"><span>${esc(t('volume'))}<output id="volume-value">${e.volume}%</output></span><input type="range" data-field="volume" min="0" max="100" value="${e.volume}"></label>
				<div class="b-field"><span>${esc(t('sound'))}${help('mediaSoundHelp')}</span><div class="b-inline"><span>${esc(t(e.sound ? 'customSound' : 'mediaDefaultSound'))}</span>${iconButton('sound', 'chooseSound', 'folder-open')}${iconButton('resetSound', 'resetSound', 'rotate-ccw')}</div></div>
				<label class="b-field"><span>${esc(t('mediaSoundVolume'))}<output id="sound-volume-value">${p.soundVolume}%</output></span><input type="range" data-presentation="soundVolume" min="0" max="100" value="${p.soundVolume}"></label>
				<div class="b-media-editor__motion">
					${select('enter', ['none', 'fade', 'slide', 'zoom', 'pop'])}
					${select('enterFrom', ['center', 'left', 'right', 'top', 'bottom'])}
					${number('enterMs', 0, 5000)}
					${select('exit', ['none', 'fade', 'slide', 'zoom', 'pop'])}
					${select('exitTo', ['center', 'left', 'right', 'top', 'bottom'])}
					${number('exitMs', 0, 5000)}
				</div>
				<div class="b-editor__actions"><button type="submit" class="b-primary">${icon('save')}${esc(t('save'))}</button><span id="save-status" class="b-muted">${esc(t(dirty ? 'unsaved' : 'saved'))}</span></div>
			</div>
			<div class="b-preview">
				<div class="b-preview__heading"><h2>${esc(t('mediaLocalPreview'))}</h2>${iconButton('replay', 'replay', 'rotate-cw')}</div>
				<div class="b-preview__canvas"><iframe id="preview" src="../overlay/index.html?preview=1" title="${esc(t('preview'))}"></iframe></div>
				<div class="b-preview__test">${button('test', 'test', 'timer')}${help('testHelp')}</div>
			</div>
		</form>`;
	updateChance();
}

// These URLs grant media reads only and never permit effect activation.
function fullscreenPreviewUrls(e) {
	const url = new URL(state.overlayUrl), key = url.hash.slice(1);
	const mediaUrl = file => `${url.origin}/media/${encodeURIComponent(file)}?key=${key}`;
	return { mediaUrl: mediaUrl(e.file), soundUrl: e.sound ? mediaUrl(e.sound) : '' };
}
