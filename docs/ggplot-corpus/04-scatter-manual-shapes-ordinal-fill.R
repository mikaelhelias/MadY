# ggplot2 reference: geom_point — manual shape scale + guide override
ggplot(mtcars, aes(wt, mpg, fill = factor(carb), shape = factor(cyl))) +
  geom_point(size = 5, stroke = 1) +
  scale_shape_manual(values = 21:25) +
  scale_fill_ordinal(guide = guide_legend(override.aes = list(shape = 21)))
