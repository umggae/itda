// 검색창 자동완성. 입력하는 동안 추천 목록이 뜨고, 고르거나 검색(엔터·검색 버튼)하면 목록이 닫힌다.
// 접근성: 스크린 리더와 키보드를 위해 ARIA "combobox" 방식을 따른다.
//   ↓ ↑ 로 추천 이동, Enter로 선택(선택한 것이 없으면 검색), Esc로 닫기.
const MIN_CHARS = 2; // 이 글자 수 이상부터 추천 (호출 수 절약)
const DELAY_MS = 300; // 마지막 입력 뒤 이만큼 멈추면 조회 (글자마다 부르지 않음)

const KIND_LABEL = { attraction: '여행지', restaurant: '음식점', hub: '거점·기타' };

// input: 검색 입력칸 / search(글자) → 장소 목록(Promise) / onPick(장소) / onSubmit() / announce(문장)
export function attachAutocomplete({ input, search, onPick, onSubmit, announce }) {
  const listId = input.id + '-suggest';
  const list = document.createElement('ul');
  list.id = listId;
  list.className = 'suggest';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', '추천 장소');
  list.hidden = true;
  input.closest('.search-row').append(list); // 검색줄 바로 아래에 뜨게 한다

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);

  let items = [];
  let active = -1;
  let timer = null;
  let ticket = 0; // 조회마다 번호를 매겨, 늦게 도착한 옛 결과가 화면을 덮어쓰지 않게 한다
  const memo = new Map(); // 같은 글자는 다시 부르지 않음

  function close() {
    clearTimeout(timer);
    ticket++; // 진행 중인 조회 결과는 버린다
    items = [];
    active = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(index) {
    active = index;
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function pick(place) {
    close();
    onPick(place);
  }

  function render(places) {
    items = places;
    active = -1;
    list.replaceChildren();
    if (places.length === 0) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    places.forEach((place, i) => {
      const li = document.createElement('li');
      li.id = listId + '-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const name = document.createElement('span');
      name.className = 'suggest-name';
      name.textContent = place.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = KIND_LABEL[place.category] + (place.address ? ' · ' + place.address : '');
      li.append(name, tag);
      // click이 아니라 mousedown: 클릭 전에 입력칸이 포커스를 잃어 목록이 닫히는 것을 막는다.
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pick(place);
      });
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    announce('추천 장소 ' + places.length + '곳. 위·아래 화살표로 고르고 Enter로 선택하세요.');
  }

  async function lookup(query) {
    const mine = ++ticket;
    try {
      const places = memo.get(query) ?? (await search(query));
      memo.set(query, places);
      if (mine === ticket && input.value.trim() === query) render(places);
    } catch {
      if (mine === ticket) close(); // 추천은 덤이므로 실패해도 조용히 닫는다 (검색 버튼에서 오류를 안내)
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < MIN_CHARS) {
      close();
      return;
    }
    timer = setTimeout(() => lookup(query), DELAY_MS);
  });

  input.addEventListener('keydown', (event) => {
    const open = !list.hidden;
    if (event.key === 'ArrowDown' && open) {
      event.preventDefault();
      setActive((active + 1) % items.length);
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setActive(active <= 0 ? items.length - 1 : active - 1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault(); // 엔터가 폼 제출(일정 검사)로 이어지지 않게
      if (open && active >= 0) pick(items[active]);
      else {
        close();
        onSubmit();
      }
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 150));

  return { close };
}
