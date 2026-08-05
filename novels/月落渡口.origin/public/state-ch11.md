# 《月落渡口》第 11 章之后的世界

## 人物（8）
- char:lin-zheng（林峥）　role=protagonist；location=loc:dukou-zhen；alive=true；left_hand_injured=false；knows=[k:space-gate-exists, k:black-key-exists, k:black-key-held-by-zhao-qi, k:black-key-origin, k:gate-time, k:key-once, k:gate-needs-two]
- char:bai-yao（白遥）　role=traitor；location=loc:guanxing-tai；alive=true；left_hand_injured=true；secret_betrayal=true；knows=[k:space-gate-exists, k:black-key-exists, k:beiting-allegiance, k:black-key-held-by-zhao-qi]；wavering=false
- char:zhao-qi（赵七）　role=broker；location=loc:dukou-teahouse；alive=true；left_hand_injured=false；knows=[k:black-key-exists]
- char:shen-yan（沈砚）　role=mentor；location=loc:guanxing-tai；alive=true；suspects_mole=true；knows=[k:space-gate-exists, k:black-key-exists, k:gate-needs-two-people]；suspects_bai_yao=false
- char:pei-zhao（裴照）　role=antagonist；location=loc:bei-ting-camp；alive=true；knows=[k:space-gate-exists]
- char:a-zhi（阿枝）　role=witness；location=loc:dukou-zhen；alive=true；knows=[k:bai-yao-meets-pei-zhao]
- char:lao-tao（老陶）　role=smith；location=loc:dukou-zhen；alive=true；knows=[k:black-key-exists, k:black-key-origin]
- char:yun-gu（云姑）　role=archivist；location=loc:guanxing-tai；alive=true；knows=[k:space-gate-exists, k:black-key-exists, k:black-key-origin]；suspects_bai_yao=false
## 势力（3）
- faction:guanxing-tai（观星台）　
- faction:bei-ting（北庭）　
- faction:dukou-neutral（渡口镇民）　
## 地点（6）
- loc:guanxing-tai（观星台）　
- loc:dukou-zhen（渡口镇）　
- loc:dukou-teahouse（渡口茶肆）　
- loc:bei-ting-camp（北庭大营）　
- loc:moon-platform（月台）　
- loc:north-corridor（北廊）　
## 物品（6）
- obj:black-key（黑钥匙）　holder=char:zhao-qi；used=false；intact=true
- obj:bronze-bell（铜铃）　location=unknown
- obj:archive-scroll（观星台档案）　holder=char:yun-gu；location=loc:guanxing-tai
- obj:missing-letter（无署名信）　location=unknown
- obj:bai-yao-dagger（白遥短刀）　holder=char:bai-yao
- obj:beiting-token（北庭令牌）　holder=char:pei-zhao
## rule（6）
- rule:gate-time　
- rule:key-once　
- rule:gate-needs-two　
- rule:leave-limit　
- rule:disarm　
- rule:bell-birds　
## 伏笔（6）
- hook:bronze-bell 铜铃夜半鸣响，来源不明　status=planted_unresolved；setup_chapter=3；payoff_chapter=19；tier=main
- hook:missing-letter 档案室无署名信失踪　status=planted_unresolved；setup_chapter=7；payoff_chapter=40；tier=main
- hook:a-zhi-witness 阿枝目睹白遥与裴照会面却缄口　status=planted_unresolved；setup_chapter=6；payoff_chapter=43；tier=main
- hook:yun-gu-silence 云姑知晓黑钥匙来历而不言　status=planted_unresolved；setup_chapter=1；payoff_chapter=14；tier=sub
- hook:shen-yan-suspicion 沈砚断定台中有内应，然不知其人　status=planted_unresolved；setup_chapter=7；tier=sub
- hook:second-bell 铜铃第二次夜响，与黑钥匙共鸣之谜　status=not_planted；setup_chapter=32；payoff_chapter=48；tier=main

## 伏笔图谱（seq 12）
- ⚠ hook:bronze-bell　埋于 ch3，回收于 ch19　铜铃夜半鸣响，来源不明
- ⚠ hook:missing-letter　埋于 ch7，回收于 ch40　档案室无署名信失踪
- ⚠ hook:a-zhi-witness　埋于 ch6，回收于 ch43　阿枝目睹白遥与裴照会面却缄口
- ⚠ hook:yun-gu-silence　埋于 ch1，回收于 ch14　云姑知晓黑钥匙来历而不言
- ⚠ hook:shen-yan-suspicion　埋于 ch7　沈砚断定台中有内应，然不知其人
- · hook:second-bell　埋于 ch32，回收于 ch48　铜铃第二次夜响，与黑钥匙共鸣之谜
