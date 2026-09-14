import json

with open("src/data/lyrics/ic3peak-boo-hoo.json", "r", encoding="utf-8") as f:
    song_data = json.load(f)

with open("/tmp/whisper_words.json", "r", encoding="utf-8") as f:
    whisper_words = json.load(f)

verses = song_data["lyricsData"]

def set_words(v_idx, word_timing_list, verse_start, verse_end):
    v = verses[v_idx]
    v_words = v["words"]
    assert len(v_words) == len(word_timing_list), f"v[{v_idx}] word count mismatch: {len(v_words)} vs {len(word_timing_list)}"
    
    for w_obj, (w_start, w_end) in zip(v_words, word_timing_list):
        w_obj["start"] = round(float(w_start), 3)
        w_obj["end"] = round(float(w_end), 3)
    
    v["verseStart"] = round(float(verse_start), 3)
    v["verseEnd"] = round(float(verse_end), 3)

# v0: Плак- плак, плак- плак (4 words)
set_words(0, [
    (2.24, 2.80),
    (2.80, 3.84),
    (5.28, 5.80),
    (5.80, 6.42),
], verse_start=2.24, verse_end=6.70)

# v1: Плак- плак, плак- плак (4 words)
set_words(1, [
    (8.20, 8.65),
    (8.65, 9.80),
    (10.16, 10.65),
    (10.65, 11.80),
], verse_start=8.20, verse_end=12.00)

# v2: Я тебе писала и ждала тебя в ночи ( плак- плак) (10 words)
set_words(2, [
    (12.06, 12.30), # Я
    (12.30, 12.70), # тебе
    (12.70, 13.30), # писала
    (13.30, 13.44), # и
    (13.44, 13.86), # ждала
    (13.86, 14.12), # тебя
    (14.12, 14.36), # в
    (14.36, 14.65), # ночи (
    (14.75, 14.92), # плак-
    (14.92, 15.12), # плак)
], verse_start=12.06, verse_end=15.15)

# v3: Ты не отвечаешь больше на мои звонки ( плак- плак) (9 words)
set_words(3, [
    (15.20, 15.35), # Ты
    (15.35, 15.60), # не
    (15.60, 16.34), # отвечаешь
    (16.34, 16.70), # больше
    (16.70, 16.98), # на
    (16.98, 17.18), # мои
    (17.18, 17.65), # звонки (
    (17.75, 17.92), # плак-
    (17.92, 18.10), # плак)
], verse_start=15.20, verse_end=18.15)

# v4: Каждый вечер оставляю под подушкой зуб ( плак- плак) (8 words)
set_words(4, [
    (18.25, 18.66), # Каждый
    (18.66, 19.10), # вечер
    (19.10, 19.72), # оставляю
    (19.72, 19.94), # под
    (19.94, 20.40), # подушкой
    (20.40, 20.65), # зуб (
    (20.75, 20.92), # плак-
    (20.92, 21.10), # плак)
], verse_start=18.25, verse_end=21.10)

# v5: Умоляю небеса назад тебя вернуть ( плак- плак) (7 words)
set_words(5, [
    (21.15, 22.04), # Умоляю
    (22.04, 22.66), # небеса
    (22.66, 22.94), # назад
    (22.94, 23.28), # тебя
    (23.28, 23.65), # вернуть (
    (23.75, 23.92), # плак-
    (23.92, 24.10), # плак)
], verse_start=21.15, verse_end=24.10)

# v6: Я была хорошей, а плохой я не была ( плак- плак) (10 words)
set_words(6, [
    (24.15, 24.46), # Я
    (24.46, 24.78), # была
    (24.78, 25.46), # хорошей,
    (25.46, 25.70), # а
    (25.70, 26.06), # плохой
    (26.06, 26.26), # я
    (26.26, 26.46), # не
    (26.46, 26.85), # была (
    (26.95, 27.12), # плак-
    (27.12, 27.30), # плак)
], verse_start=24.15, verse_end=27.30)

# v7: Я всю жизнь, как паинька, по правилам жила ( плак- плак) (10 words)
set_words(7, [
    (27.35, 27.48), # Я
    (27.48, 27.64), # всю
    (27.64, 27.88), # жизнь,
    (27.88, 28.16), # как
    (28.16, 28.62), # паинька,
    (28.62, 28.88), # по
    (28.88, 29.42), # правилам
    (29.42, 30.12), # жила (
    (30.20, 30.38), # плак-
    (30.38, 30.55), # плак)
], verse_start=27.35, verse_end=30.55)

# v8: Надоело плакать, надоело мне страдать ( плак- плак) (7 words)
set_words(8, [
    (30.60, 31.06), # Надоело
    (31.06, 31.50), # плакать,
    (31.55, 32.20), # надоело
    (32.20, 32.46), # мне
    (32.46, 33.32), # страдать (
    (33.40, 33.58), # плак-
    (33.58, 33.75), # плак)
], verse_start=30.60, verse_end=33.75)

# v9: Всё равно не выйдет свою смерть предугадать ( плак- плак) (9 words)
set_words(9, [
    (33.80, 34.00), # Всё
    (34.00, 34.20), # равно
    (34.20, 34.40), # не
    (34.40, 34.80), # выйдет
    (34.80, 35.10), # свою
    (35.10, 35.50), # смерть
    (35.50, 36.20), # предугадать (
    (36.30, 36.48), # плак-
    (36.48, 36.65), # плак)
], verse_start=33.80, verse_end=36.65)

# v10: Ла- ла- ла- ла- ла- а- а- а (8 words, 37.00s - 42.25s)
v10_step = (42.25 - 37.00) / 8
set_words(10, [
    (round(37.00 + i * v10_step, 3), round(37.00 + (i + 1) * v10_step, 3))
    for i in range(8)
], verse_start=37.00, verse_end=42.35)

# v11: Ла- ла- ла- ла- ла- а- а- а (8 words, 42.75s - 45.30s)
v11_step = (45.30 - 42.75) / 8
set_words(11, [
    (round(42.75 + i * v11_step, 3), round(42.75 + (i + 1) * v11_step, 3))
    for i in range(8)
], verse_start=42.75, verse_end=45.40)

# v12: Мама говорила мне: " Слушайся мужа" (5 words)
set_words(12, [
    (whisper_words[58]["start"], whisper_words[58]["end"]),   # Мама
    (whisper_words[59]["start"], whisper_words[59]["end"]),   # говорила
    (whisper_words[60]["start"], whisper_words[60]["end"]),   # мне: "
    (whisper_words[61]["start"], whisper_words[61]["end"]),   # Слушайся
    (whisper_words[62]["start"], whisper_words[62]["end"]),   # мужа"
], verse_start=47.21, verse_end=51.60)

# v13: Я не послушна, я делаю хуже (6 words)
set_words(13, [
    (whisper_words[63]["start"], whisper_words[63]["end"]),   # Я
    (whisper_words[64]["start"], whisper_words[64]["end"]),   # не
    (whisper_words[65]["start"], whisper_words[65]["end"]),   # послушна,
    (53.18, 53.35),                                           # я
    (53.35, 53.86),                                           # делаю
    (whisper_words[67]["start"], whisper_words[67]["end"]),   # хуже
], verse_start=51.60, verse_end=54.70)

# v14: Делаю не так, как наказывал папа (6 words)
set_words(14, [
    (whisper_words[68]["start"], whisper_words[68]["end"]),   # Делаю
    (whisper_words[69]["start"], whisper_words[69]["end"]),   # не
    (whisper_words[70]["start"], whisper_words[70]["end"]),   # так,
    (whisper_words[71]["start"], whisper_words[71]["end"]),   # как
    (whisper_words[72]["start"], whisper_words[72]["end"]),   # наказывал
    (whisper_words[73]["start"], whisper_words[73]["end"]),   # папа
], verse_start=54.92, verse_end=57.62)

# v15: Вместо звезды я хватаю гранату (5 words)
set_words(15, [
    (whisper_words[74]["start"], whisper_words[74]["end"]),   # Вместо
    (whisper_words[75]["start"], whisper_words[75]["end"]),   # звезды
    (58.80, 59.05),                                           # я
    (59.05, 59.60),                                           # хватаю
    (whisper_words[77]["start"], whisper_words[77]["end"]),   # гранату
], verse_start=57.62, verse_end=60.60)

# v16: Мама говорила мне: " Слушайся мужа" (5 words)
set_words(16, [
    (whisper_words[78]["start"], whisper_words[78]["end"]),   # Мама
    (whisper_words[79]["start"], whisper_words[79]["end"]),   # говорила
    (whisper_words[80]["start"], whisper_words[80]["end"]),   # мне: "
    (whisper_words[81]["start"], whisper_words[81]["end"]),   # Слушайся
    (whisper_words[82]["start"], whisper_words[82]["end"]),   # мужа"
], verse_start=60.60, verse_end=63.72)

# v17: Я не послушна, я делаю хуже (6 words)
set_words(17, [
    (whisper_words[83]["start"], whisper_words[83]["end"]),   # Я
    (whisper_words[84]["start"], whisper_words[84]["end"]),   # не
    (whisper_words[85]["start"], whisper_words[85]["end"]),   # послушна,
    (65.32, 65.50),                                           # я
    (65.50, 66.02),                                           # делаю
    (whisper_words[87]["start"], whisper_words[87]["end"]),   # хуже
], verse_start=63.72, verse_end=66.80)

# v18: Делаю не так, как наказывал папа (6 words)
set_words(18, [
    (whisper_words[88]["start"], whisper_words[88]["end"]),   # Делаю
    (whisper_words[89]["start"], whisper_words[89]["end"]),   # не
    (whisper_words[90]["start"], whisper_words[90]["end"]),   # так,
    (whisper_words[91]["start"], whisper_words[91]["end"]),   # как
    (whisper_words[92]["start"], whisper_words[92]["end"]),   # наказывал
    (whisper_words[93]["start"], whisper_words[93]["end"]),   # папа
], verse_start=66.96, verse_end=69.85)

# v19: Вместо звезды я хватаю гранату (5 words)
set_words(19, [
    (whisper_words[94]["start"], whisper_words[94]["end"]),   # Вместо
    (whisper_words[95]["start"], whisper_words[95]["end"]),   # звезды
    (70.98, 71.20),                                           # я
    (71.20, 71.76),                                           # хватаю
    (whisper_words[97]["start"], whisper_words[97]["end"]),   # гранату
], verse_start=69.92, verse_end=72.80)

# v20: Я хотела бы тебя, как тогда, обнять (7 words)
set_words(20, [
    (whisper_words[98]["start"], whisper_words[98]["end"]),   # Я
    (whisper_words[99]["start"], whisper_words[99]["end"]),   # хотела
    (whisper_words[100]["start"], whisper_words[100]["end"]), # бы
    (whisper_words[101]["start"], whisper_words[101]["end"]), # тебя,
    (whisper_words[102]["start"], whisper_words[102]["end"]), # как
    (whisper_words[103]["start"], whisper_words[103]["end"]), # тогда,
    (whisper_words[104]["start"], whisper_words[104]["end"]), # обнять
], verse_start=72.82, verse_end=78.75)

# v21: Но для этого придётся тело раскопать (6 words)
set_words(21, [
    (whisper_words[105]["start"], whisper_words[105]["end"]), # Но
    (whisper_words[106]["start"], whisper_words[106]["end"]), # для
    (whisper_words[107]["start"], whisper_words[107]["end"]), # этого
    (whisper_words[108]["start"], whisper_words[108]["end"]), # придётся
    (whisper_words[109]["start"], whisper_words[109]["end"]), # тело
    (whisper_words[110]["start"], whisper_words[110]["end"]), # раскопать
], verse_start=78.76, verse_end=84.50)

# v22: Твои кости ледяные где- то там на дне (8 words)
set_words(22, [
    (whisper_words[111]["start"], whisper_words[111]["end"]), # Твои
    (whisper_words[112]["start"], whisper_words[112]["end"]), # кости
    (whisper_words[113]["start"], whisper_words[113]["end"]), # ледяные
    (whisper_words[114]["start"], whisper_words[114]["end"]), # где-
    (whisper_words[115]["start"], whisper_words[115]["end"]), # то
    (whisper_words[116]["start"], whisper_words[116]["end"]), # там
    (whisper_words[117]["start"], whisper_words[117]["end"]), # на
    (whisper_words[118]["start"], whisper_words[118]["end"]), # дне
], verse_start=84.72, verse_end=90.78)

# v23: Прорастут цветы в этой оплаканной земле (6 words)
set_words(23, [
    (whisper_words[119]["start"], whisper_words[119]["end"]), # Прорастут
    (whisper_words[120]["start"], whisper_words[120]["end"]), # цветы
    (whisper_words[121]["start"], whisper_words[121]["end"]), # в
    (whisper_words[122]["start"], whisper_words[122]["end"]), # этой
    (whisper_words[123]["start"], whisper_words[123]["end"]), # оплаканной
    (whisper_words[124]["start"], whisper_words[124]["end"]), # земле
], verse_start=90.78, verse_end=97.15)

# v24: Плак- плак, плак- плак (4 words)
set_words(24, [
    (99.48, 100.00),
    (100.00, 100.66),
    (102.50, 103.10),
    (103.10, 104.06),
], verse_start=99.48, verse_end=104.10)

# v25: Плак- плак, плак- плак (4 words)
set_words(25, [
    (104.20, 104.80),
    (104.80, 105.40),
    (105.50, 106.00),
    (106.00, 106.70),
], verse_start=104.20, verse_end=106.80)

# v26: Растекаются по всей стене твои мозги ( плак- плак) (8 words)
set_words(26, [
    (whisper_words[128]["start"], whisper_words[128]["end"]), # Растекаются
    (whisper_words[129]["start"], whisper_words[129]["end"]), # по
    (whisper_words[130]["start"], whisper_words[130]["end"]), # всей
    (whisper_words[131]["start"], whisper_words[131]["end"]), # стене
    (whisper_words[132]["start"], whisper_words[132]["end"]), # твои
    (111.48, 111.85),                                         # мозги (
    (111.85, 111.95),                                         # плак-
    (111.95, 112.02),                                         # плак)
], verse_start=109.44, verse_end=112.02)

# v27: Очень разозлилась на тебя, ты уж прости ( плак- плак) (9 words)
set_words(27, [
    (whisper_words[134]["start"], whisper_words[134]["end"]), # Очень
    (whisper_words[135]["start"], whisper_words[135]["end"]), # разозлилась
    (113.65, 113.74),                                         # на
    (whisper_words[137]["start"], whisper_words[137]["end"]), # тебя,
    (whisper_words[138]["start"], whisper_words[138]["end"]), # ты
    (whisper_words[139]["start"], whisper_words[139]["end"]), # уж
    (114.56, 115.15),                                         # прости (
    (115.15, 115.30),                                         # плак-
    (115.30, 115.44),                                         # плак)
], verse_start=112.02, verse_end=115.44)

# v28: Сотый раз во сне я наблюдаю твой конец ( плак- плак) (10 words)
set_words(28, [
    (whisper_words[141]["start"], whisper_words[141]["end"]), # Сотый
    (whisper_words[142]["start"], whisper_words[142]["end"]), # раз
    (whisper_words[143]["start"], whisper_words[143]["end"]), # во
    (whisper_words[144]["start"], whisper_words[144]["end"]), # сне
    (whisper_words[145]["start"], whisper_words[145]["end"]), # я
    (whisper_words[146]["start"], whisper_words[146]["end"]), # наблюдаю
    (whisper_words[147]["start"], whisper_words[147]["end"]), # твой
    (117.58, 118.05),                                         # конец (
    (118.05, 118.18),                                         # плак-
    (118.18, 118.32),                                         # плак)
], verse_start=115.44, verse_end=118.32)

# v29: И не так уж страшно, в самом деле, умереть ( плак- плак) (11 words)
set_words(29, [
    (whisper_words[149]["start"], whisper_words[149]["end"]), # И
    (whisper_words[150]["start"], whisper_words[150]["end"]), # не
    (whisper_words[151]["start"], whisper_words[151]["end"]), # так
    (whisper_words[152]["start"], whisper_words[152]["end"]), # уж
    (whisper_words[153]["start"], whisper_words[153]["end"]), # страшно,
    (whisper_words[154]["start"], whisper_words[154]["end"]), # в
    (whisper_words[155]["start"], whisper_words[155]["end"]), # самом
    (whisper_words[156]["start"], whisper_words[156]["end"]), # деле,
    (120.40, 120.90),                                         # умереть (
    (120.90, 121.05),                                         # плак-
    (121.05, 121.20),                                         # плак)
], verse_start=118.32, verse_end=121.20)

# v30: Я была хорошей, а плохой я не была ( плак- плак) (10 words)
set_words(30, [
    (whisper_words[158]["start"], whisper_words[158]["end"]), # Я
    (whisper_words[159]["start"], whisper_words[159]["end"]), # была
    (whisper_words[160]["start"], whisper_words[160]["end"]), # хорошей,
    (whisper_words[161]["start"], whisper_words[161]["end"]), # а
    (whisper_words[162]["start"], whisper_words[162]["end"]), # плохой
    (whisper_words[163]["start"], whisper_words[163]["end"]), # я
    (whisper_words[164]["start"], whisper_words[164]["end"]), # не
    (123.68, 124.00),                                         # была (
    (124.00, 124.13),                                         # плак-
    (124.13, 124.26),                                         # плак)
], verse_start=121.20, verse_end=124.26)

# v31: И всю жизнь как паинька, по правилам жила ( плак- плак) (10 words)
set_words(31, [
    (whisper_words[166]["start"], whisper_words[166]["end"]), # И
    (whisper_words[167]["start"], whisper_words[167]["end"]), # всю
    (whisper_words[168]["start"], whisper_words[168]["end"]), # жизнь
    (whisper_words[169]["start"], whisper_words[169]["end"]), # как
    (whisper_words[170]["start"], whisper_words[170]["end"]), # паинька,
    (whisper_words[171]["start"], whisper_words[171]["end"]), # по
    (whisper_words[172]["start"], whisper_words[172]["end"]), # правилам
    (126.62, 127.00),                                         # жила (
    (127.00, 127.14),                                         # плак-
    (127.14, 127.28),                                         # плак)
], verse_start=124.26, verse_end=127.28)

# v32: Надоело плакать, надоело мне страдать ( плак- плак) (7 words)
set_words(32, [
    (whisper_words[174]["start"], whisper_words[174]["end"]), # Надоело
    (whisper_words[175]["start"], whisper_words[175]["end"]), # плакать,
    (whisper_words[176]["start"], whisper_words[176]["end"]), # надоело
    (whisper_words[177]["start"], whisper_words[177]["end"]), # мне
    (129.68, 130.15),                                         # страдать (
    (130.15, 130.30),                                         # плак-
    (130.30, 130.46),                                         # плак)
], verse_start=127.28, verse_end=130.46)

# v33: Всё равно не выйдет свою смерть предугадать ( плак- плак) (9 words)
set_words(33, [
    (whisper_words[179]["start"], whisper_words[179]["end"]), # Всё
    (whisper_words[180]["start"], whisper_words[180]["end"]), # равно
    (whisper_words[181]["start"], whisper_words[181]["end"]), # не
    (whisper_words[182]["start"], whisper_words[182]["end"]), # выйдет
    (whisper_words[183]["start"], whisper_words[183]["end"]), # свою
    (whisper_words[184]["start"], whisper_words[184]["end"]), # смерть
    (132.50, 132.75),                                         # предугадать (
    (132.75, 132.86),                                         # плак-
    (132.86, 132.98),                                         # плак)
], verse_start=130.46, verse_end=132.98)

# v34: Мама говорила мне: " Слушайся мужа" (5 words)
set_words(34, [
    (whisper_words[186]["start"], whisper_words[186]["end"]), # Мама
    (whisper_words[187]["start"], whisper_words[187]["end"]), # говорила
    (whisper_words[188]["start"], whisper_words[188]["end"]), # мне: "
    (whisper_words[189]["start"], whisper_words[189]["end"]), # Слушайся
    (whisper_words[190]["start"], whisper_words[190]["end"]), # мужа"
], verse_start=132.98, verse_end=136.64)

# v35: Я не послушна, я делаю хуже (6 words)
set_words(35, [
    (whisper_words[191]["start"], whisper_words[191]["end"]), # Я
    (whisper_words[192]["start"], whisper_words[192]["end"]), # не
    (whisper_words[193]["start"], whisper_words[193]["end"]), # послушна,
    (138.16, 138.50),                                         # я
    (138.50, 138.96),                                         # делаю
    (whisper_words[195]["start"], whisper_words[195]["end"]), # хуже
], verse_start=136.64, verse_end=139.64)

# v36: Делаю не так, как наказывал папа (6 words)
set_words(36, [
    (139.64, 140.28),                                         # Делаю
    (whisper_words[197]["start"], whisper_words[197]["end"]), # не
    (whisper_words[198]["start"], whisper_words[198]["end"]), # так,
    (whisper_words[199]["start"], whisper_words[199]["end"]), # как
    (whisper_words[200]["start"], whisper_words[200]["end"]), # наказывал
    (whisper_words[201]["start"], whisper_words[201]["end"]), # папа
], verse_start=139.64, verse_end=142.70)

# v37: Вместо звезды я хватаю гранату (5 words)
set_words(37, [
    (whisper_words[202]["start"], whisper_words[202]["end"]), # Вместо
    (whisper_words[203]["start"], whisper_words[203]["end"]), # звезды
    (143.94, 144.15),                                         # я
    (144.15, 144.68),                                         # хватаю
    (whisper_words[205]["start"], whisper_words[205]["end"]), # гранату
], verse_start=142.88, verse_end=145.74)

# v38: Мама говорила мне: " Слушайся мужа" (5 words, screamed chorus: 145.75 - 148.65)
set_words(38, [
    (145.75, 146.40), # Мама
    (146.40, 147.10), # говорила
    (147.10, 147.60), # мне: "
    (147.60, 148.15), # Слушайся
    (148.15, 148.65), # мужа"
], verse_start=145.75, verse_end=148.70)

# v39: Я не послушна, я делаю хуже (6 words, screamed chorus: 149.20 - 151.70)
set_words(39, [
    (149.20, 149.45), # Я
    (149.45, 149.75), # не
    (149.75, 150.50), # послушна,
    (150.50, 150.75), # я
    (150.75, 151.20), # делаю
    (151.20, 151.70), # хуже
], verse_start=149.20, verse_end=151.75)

# v40: Делаю не так, как наказывал папа (6 words, screamed chorus: 152.00 - 154.70)
set_words(40, [
    (152.00, 152.50), # Делаю
    (152.50, 152.80), # не
    (152.80, 153.20), # так,
    (153.20, 153.50), # как
    (153.50, 154.10), # наказывал
    (154.10, 154.70), # папа
], verse_start=152.00, verse_end=154.75)

# v41: Вместо звезды я хватаю гранату (5 words, screamed chorus: 155.20 - 157.75)
set_words(41, [
    (155.20, 155.65), # Вместо
    (155.65, 156.25), # звезды
    (156.25, 156.55), # я
    (156.55, 157.10), # хватаю
    (157.10, 157.75), # гранату
], verse_start=155.20, verse_end=157.80)

# v42: Ла- ла- ла- ла- ла- а- а- а (8 words, 158.20s - 160.75s)
v42_step = (160.75 - 158.20) / 8
set_words(42, [
    (round(158.20 + i * v42_step, 3), round(158.20 + (i + 1) * v42_step, 3))
    for i in range(8)
], verse_start=158.20, verse_end=160.80)

# v43: Ла- ла- ла- ла- ла- а- а- а (8 words, 161.20s - 163.75s)
v43_step = (163.75 - 161.20) / 8
set_words(43, [
    (round(161.20 + i * v43_step, 3), round(161.20 + (i + 1) * v43_step, 3))
    for i in range(8)
], verse_start=161.20, verse_end=163.80)

# v44: Ла- ла- ла- ла- ла- а- а- а (8 words, 164.20s - 166.75s)
v44_step = (166.75 - 164.20) / 8
set_words(44, [
    (round(164.20 + i * v44_step, 3), round(164.20 + (i + 1) * v44_step, 3))
    for i in range(8)
], verse_start=164.20, verse_end=166.80)

# v45: Ла- ла- ла- ла- ла- а- а- а (8 words, 166.80s - 168.05s)
v45_step = (168.05 - 166.80) / 8
set_words(45, [
    (round(166.80 + i * v45_step, 3), round(166.80 + (i + 1) * v45_step, 3))
    for i in range(8)
], verse_start=166.80, verse_end=168.08)

# v46: Я хотела бы тебя, как тогда, обнять (7 words)
set_words(46, [
    (whisper_words[206]["start"], whisper_words[206]["end"]), # Я
    (whisper_words[207]["start"], whisper_words[207]["end"]), # хотела
    (whisper_words[208]["start"], whisper_words[208]["end"]), # бы
    (whisper_words[209]["start"], whisper_words[209]["end"]), # тебя,
    (whisper_words[210]["start"], whisper_words[210]["end"]), # как
    (whisper_words[211]["start"], whisper_words[211]["end"]), # тогда,
    (whisper_words[212]["start"], whisper_words[212]["end"]), # обнять
], verse_start=168.10, verse_end=175.90)

# v47: Но для этого придётся тело раскопать (6 words)
set_words(47, [
    (whisper_words[213]["start"], whisper_words[213]["end"]), # Но
    (whisper_words[214]["start"], whisper_words[214]["end"]), # для
    (whisper_words[215]["start"], whisper_words[215]["end"]), # этого
    (whisper_words[216]["start"], whisper_words[216]["end"]), # придётся
    (whisper_words[217]["start"], whisper_words[217]["end"]), # тело
    (whisper_words[218]["start"], whisper_words[218]["end"]), # раскопать
], verse_start=176.00, verse_end=181.50)

# v48: Твои кости ледяные где- то там на дне (8 words)
set_words(48, [
    (whisper_words[219]["start"], whisper_words[219]["end"]), # Твои
    (whisper_words[220]["start"], whisper_words[220]["end"]), # кости
    (whisper_words[221]["start"], whisper_words[221]["end"]), # ледяные
    (whisper_words[222]["start"], whisper_words[222]["end"]), # где-
    (whisper_words[223]["start"], whisper_words[223]["end"]), # то
    (whisper_words[224]["start"], whisper_words[224]["end"]), # там
    (whisper_words[225]["start"], whisper_words[225]["end"]), # на
    (whisper_words[226]["start"], whisper_words[226]["end"]), # дне
], verse_start=182.16, verse_end=187.95)

# v49: Прорастут цветы в этой оплаканной земле (6 words)
set_words(49, [
    (whisper_words[227]["start"], whisper_words[227]["end"]), # Прорастут
    (whisper_words[228]["start"], whisper_words[228]["end"]), # цветы
    (whisper_words[229]["start"], whisper_words[229]["end"]), # в
    (whisper_words[230]["start"], whisper_words[230]["end"]), # этой
    (whisper_words[231]["start"], whisper_words[231]["end"]), # оплаканной
    (whisper_words[232]["start"], whisper_words[232]["end"]), # земле
], verse_start=187.92, verse_end=193.70)

# Rigorous Consistency Validations
prev_end = 0.0
for i, v in enumerate(verses):
    v_start = v["verseStart"]
    v_end = v["verseEnd"]
    v_words = v["words"]
    
    assert v_start <= v_end, f"Verse {i}: verseStart ({v_start}) > verseEnd ({v_end})"
    assert v_start >= prev_end - 0.05, f"Verse {i}: verseStart ({v_start}) jumped back before previous verse end ({prev_end})"
    
    for wi, w in enumerate(v_words):
        w_start = w["start"]
        w_end = w["end"]
        assert w_start <= w_end, f"Verse {i} word {wi} ({w['word']}): start ({w_start}) > end ({w_end})"
        assert w_start >= v_start - 0.05, f"Verse {i} word {wi} ({w['word']}): start ({w_start}) < verseStart ({v_start})"
        assert w_end <= v_end + 0.05, f"Verse {i} word {wi} ({w['word']}): end ({w_end}) > verseEnd ({v_end})"
        if wi > 0:
            assert w_start >= v_words[wi-1]["start"] - 0.01, f"Verse {i} word {wi}: start < previous word start"
    
    prev_end = v_end
    text = "".join(w["word"] for w in v_words).strip()
    print(f"v[{i:02d}] {v_start:6.2f}s - {v_end:6.2f}s | {text}")

out_path = "src/data/lyrics/ic3peak-boo-hoo.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(song_data, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"\n[✓] Successfully verified and written all 50 realigned verses to {out_path}!")
