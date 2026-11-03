# ggplot2 reference: facet_wrap by two variables + labeller
ggplot(mpg, aes(displ, hwy)) +
  geom_point() +
  facet_wrap(vars(cyl, drv), labeller = "label_both")
